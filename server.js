const smpp = require('smpp');
const crypto = require('crypto');
const messageQueue = require('./redis-handler');

let clientSession = null;

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

  // Store delivery receipt
  await messageQueue.createOrUpdateEntry(vendorMsgId, {
    deliveryReceipt: JSON.stringify(pdu),
  });

  // Wait for both pieces of information to be available
  const completeEntry = await messageQueue.waitForCompletion(vendorMsgId);

  // Process the delivery receipt
  const completePdu = JSON.parse(completeEntry.deliveryReceipt);
  processDeliveryReceipt(completePdu, completeEntry.serverMsgId, 'TWO');
  await messageQueue.deleteQueueEntry(vendorMsgId);

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

        await sleep(2000);

        // Store server message ID
        await messageQueue.createOrUpdateEntry(vendorMsgId, {
          serverMsgId: serverMsgId,
        });

        // Wait for both pieces of information to be available
        const completeEntry = await messageQueue.waitForCompletion(vendorMsgId);

        // Process the delivery receipt
        const completePdu = JSON.parse(completeEntry.deliveryReceipt);
        processDeliveryReceipt(completePdu, completeEntry.serverMsgId, 'ONE');
        await messageQueue.deleteQueueEntry(vendorMsgId);
      }
    );
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Helper function to process delivery receipt
function processDeliveryReceipt(pdu, serverMsgId, type) {
  console.log(type);
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

// Cleanup on server shutdown
process.on('SIGTERM', async () => {
  await messageQueue.redis.quit();
  process.exit(0);
});
