const smpp = require('smpp');
const crypto = require('crypto');

let clientSession = null;

// Create a structure to hold message mappings with promises
const messageQueue = new Map(); // Key: vendorMsgId, Value: {promise, resolve, serverMsgId?, deliveryReceipt?}

// Create connection to vendor
const vendorSession = new smpp.Session({ host: '127.0.0.1', port: 2776 });

vendorSession.on('error', (error) => {
  console.log('Server->Vendor connection error:', error);
});

vendorSession.on('connect', () => {
  console.log('Server connected to vendor');

  // Bind as transceiver to vendor
  vendorSession.bind_transceiver(
    {
      system_id: 'SERVER',
      password: 'password',
    },
    (pdu) => {
      if (pdu.command_status === 0) {
        console.log('Server bound to vendor successfully');
      }
    }
  );
});

// Handle deliver_sm from vendor
vendorSession.on('deliver_sm', async (pdu) => {
  console.log('Server: Received deliver_sm from vendor');
  const vendorMsgId = pdu.receipted_message_id;

  // Simulate some side effect delay
  await sleep(4000);
  console.log('after 4 seconds');

  let queueEntry = messageQueue.get(vendorMsgId);
  if (!queueEntry) {
    console.log('++++++++++++++');
    // Create a new entry if one doesn't exist
    let resolvePromise;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    queueEntry = {
      promise,
      resolve: resolvePromise,
      deliveryReceipt: pdu,
    };
    messageQueue.set(vendorMsgId, queueEntry);
  } else {
    console.log('---------------');
    // Add delivery receipt to existing entry
    queueEntry.deliveryReceipt = pdu;
    if (queueEntry.serverMsgId) {
      queueEntry.resolve({
        serverMsgId: queueEntry.serverMsgId,
        deliveryReceipt: pdu,
      });
    }
  }

  // Wait for both pieces of information
  const result = await queueEntry.promise;
  processDeliveryReceipt(result.deliveryReceipt, result.serverMsgId);
  messageQueue.delete(vendorMsgId);

  // Send deliver_sm_resp to vendor immediately
  vendorSession.deliver_sm_resp({
    command_status: 0,
    sequence_number: pdu.sequence_number,
  });
});

const server = smpp.createServer((session) => {
  console.log('Server: New client session created');
  clientSession = session;

  session.on('error', (error) => {
    console.log('Server<->Client session error:', error);
  });

  session.on('bind_transceiver', (pdu) => {
    session.send(pdu.response());
    console.log('Server: Client bound');
  });

  // Handle submit_sm from client
  session.on('submit_sm', (pdu) => {
    console.log('Server: Received submit_sm from client');
    const serverMsgId = crypto.randomBytes(8).toString('hex');

    // Send response to client
    session.send(
      pdu.response({
        message_id: serverMsgId,
      })
    );

    // Forward to vendor
    vendorSession.submit_sm(
      {
        ...pdu,
        sequence_number: undefined,
      },
      async (vendorPdu) => {
        console.log('Server: Received vendor response');
        const vendorMsgId = vendorPdu.message_id;

        // Simulate some side effect delay
        // await sleep(4000);
        // console.log('after 4 seconds');

        let queueEntry = messageQueue.get(vendorMsgId);
        if (!queueEntry) {
          console.log('###################');
          // Create a new entry if one doesn't exist
          let resolvePromise;
          const promise = new Promise((resolve) => {
            resolvePromise = resolve;
          });

          queueEntry = {
            promise,
            resolve: resolvePromise,
            serverMsgId: serverMsgId,
          };
          messageQueue.set(vendorMsgId, queueEntry);
        } else {
          console.log('& & & & & & & & & & &');
          // Add serverMsgId to existing entry
          queueEntry.serverMsgId = serverMsgId;
          if (queueEntry.deliveryReceipt) {
            queueEntry.resolve({
              serverMsgId: serverMsgId,
              deliveryReceipt: queueEntry.deliveryReceipt,
            });
          }
        }

        // Wait for both pieces of information
        const result = await queueEntry.promise;
        processDeliveryReceipt(result.deliveryReceipt, result.serverMsgId);
        messageQueue.delete(vendorMsgId);
      }
    );
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Helper function to process delivery receipt
function processDeliveryReceipt(pdu, serverMsgId) {
  if (clientSession) {
    // Replace vendor message ID with server message ID
    const modifiedPdu = {
      ...pdu,
      receipted_message_id: serverMsgId,
    };

    // Forward to client
    clientSession.deliver_sm(modifiedPdu, (resp) => {
      console.log('Server: Delivered to client');
    });
  }
}

server.listen(2775, () => console.log('Server: Listening on port 2775'));
