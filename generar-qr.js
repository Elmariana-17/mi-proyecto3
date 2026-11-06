const QRCode = require('qrcode');
const baseUrl = process.argv[2]; // el argumento que pasas

// Si la URL no termina en /survey.html, se lo agregamos
const urlFinal = baseUrl.endsWith('/survey.html') 
  ? baseUrl 
  : baseUrl.replace(/\/$/, '') + '/survey.html';

QRCode.toFile('qr.png', urlFinal, (err) => {
  if (err) throw err;
  console.log('QR generado con la URL:', urlFinal);
});