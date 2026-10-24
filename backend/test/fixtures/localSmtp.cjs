// Loaded only by the isolated integration check's child processes.
// Keep the real API/worker code while routing SMTP to a loopback test server.
const nodemailer = require('nodemailer');
const ethereal = require('../../dist/services/etherealService');
const search = require('../../dist/config/elasticsearch');
const senderEmail = 'scheduler-audit@example.test';
const transporter = nodemailer.createTransport({
  host: '127.0.0.1', port: Number(process.env.AUDIT_SMTP_PORT),
  secure: false, ignoreTLS: true, connectionTimeout: 3000, socketTimeout: 5000,
});
ethereal.initEtherealAccounts = async () => {};
ethereal.getEtherealSenderAccounts = () => [{ email: senderEmail }];
ethereal.sendEmail = async ({ to, subject, html }) => {
  const result = await transporter.sendMail({ from: senderEmail, to, subject, html });
  return { messageId: result.messageId, previewUrl: 'http://localhost/integration-preview' };
};
// Search and OAuth are deliberately outside this delivery integration check.
search.connectElasticsearch = async () => {};
search.indexEmailJobsBulk = async () => {};
search.indexEmailJob = async () => {};
search.updateEmailJobIndex = async () => {};
