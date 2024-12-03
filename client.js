const smpp = require('smpp');
const session = new smpp.Session({ host: '127.0.0.1', port: 2775 });

// Message ID mapping (if needed to track responses)
const messageIdMap = new Map();
let myCount = 0;

session.on('error', (error) => {
  console.log('Client error:', error);
});

session.on('connect', () => {
  console.log('Client connected');

  // Bind as transmitter
  session.bind_transceiver(
    {
      system_id: 'CLIENT',
      password: 'password',
    },
    (pdu) => {
      if (pdu.command_status === 0) {
        console.log('Client bound successfully');

        let count = 1;
        // Send submit_sm periodically
        setInterval(() => {
          if (count > 3) {
            return;
          }
          Array.from({ length: 10 }, (_, i) => i).forEach((element, index) => {
            session.submit_sm(
              {
                source_addr: '1234',
                destination_addr: '5678',
                short_message: `Hello, World! ${index}`,
              },
              (pdu) => {
                console.log('Submit SM Response received:', pdu.message_id);
              }
            );
          });
          count++;
        }, 1000);
      }
    }
  );
});

// Handle deliver_sm
session.on('deliver_sm', (pdu) => {
  myCount++;
  console.log('Received deliver_sm:', pdu.receipted_message_id);

  // Send delivery acknowledgment
  session.deliver_sm_resp({
    command_status: 0,
    sequence_number: pdu.sequence_number,
  });
});

setInterval(() => {
  console.log(myCount);
}, 2000);
