const smpp = require('smpp');
const crypto = require('crypto');

const server = smpp.createServer((session) => {
  console.log('Vendor: New session created');

  session.on('error', (error) => {
    console.log('Vendor error:', error);
  });

  session.on('bind_transceiver', (pdu) => {
    session.send(pdu.response());
    console.log('Vendor: Server bound');
  });

  // Handle submit_sm from server
  session.on('submit_sm', (pdu) => {
    console.log('Vendor: Received submit_sm from server');

    // Generate vendor message ID
    const vendorMsgId = crypto.randomBytes(8).toString('hex');

    // Send response
    session.send(
      pdu.response({
        message_id: vendorMsgId,
      })
    );

    // Simulate delivery report after delay
    // setTimeout(() => {
    session.deliver_sm({
      source_addr: pdu.destination_addr,
      destination_addr: pdu.source_addr,
      receipted_message_id: vendorMsgId,
      short_message: 'DELIVERED',
      esm_class: 0x04,
    });
    // }, 2000);
  });
});

server.listen(2776, () => console.log('Vendor: Listening on port 2776'));
