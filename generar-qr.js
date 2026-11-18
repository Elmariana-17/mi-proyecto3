const QRCode = require('qrcode');
const baseUrl = process.argv[2]; 

const urlFinal = baseUrl.endsWith('/survey.html') 
  ? baseUrl 
  : baseUrl.replace(/\/$/, '') + '/survey.html';

QRCode.toFile('qr.png', urlFinal, (err) => {
  if (err) throw err;
  console.log('QR generado con la URL:', urlFinal);
});