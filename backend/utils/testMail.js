const path = require("path");

// Load .env from the project root
require("dotenv").config({
  path: path.join(__dirname, "../../.env")
});

const nodemailer = require("nodemailer");

console.log("EMAIL_HOST:", process.env.EMAIL_HOST);
console.log("EMAIL_PORT:", process.env.EMAIL_PORT);
console.log("EMAIL_USER:", process.env.EMAIL_USER);
console.log("EMAIL_PASS:", process.env.EMAIL_PASS ? "Loaded" : "Missing");

async function test() {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT),
      secure: process.env.EMAIL_SECURE === "true",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.verify();
    console.log("✅ SMTP Connected");

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      subject: "Test Email",
      text: "Email working successfully."
    });

    console.log("✅ Email Sent Successfully");

  } catch (err) {
    console.error("❌ Error:", err);
  }
}

test();