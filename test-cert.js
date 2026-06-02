const selfsigned = require('selfsigned');
const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems = selfsigned.generate(attrs, { 
  keySize: 2048, 
  days: 365, 
  algorithm: 'sha256',
  extensions: [
    { name: 'basicConstraints', cA: true },
    { name: 'subjectAltName', altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' }
    ]}
  ]
});
console.log(pems.cert.substring(0, 50));
