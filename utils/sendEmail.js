const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
  // Use Ethereal Email for dev testing (generates an inbox link automatically)
  // In production, user will swap with their SMTP credentials via process.env
  let transporter;
  
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: process.env.SMTP_PORT || 587,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    // Generate test account automatically
    let testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false, 
      auth: {
        user: testAccount.user, // generated ethereal user
        pass: testAccount.pass, // generated ethereal password
      },
    });
  }

  const message = {
    from: `${process.env.FROM_NAME || 'VeriProof System'} <${process.env.FROM_EMAIL || 'noreply@veriproof.com'}>`,
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html || `<p>${options.message}</p>`
  };

  const info = await transporter.sendMail(message);

  if (!process.env.SMTP_USER) {
    console.log("---------------------------------------");
    console.log("DEV MAIL DELIVERED:");
    console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
    console.log("---------------------------------------");
  }
};

module.exports = sendEmail;
