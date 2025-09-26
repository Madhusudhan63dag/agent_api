require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
const Razorpay = require("razorpay"); // Add Razorpay SDK
const crypto = require("crypto"); // For payment verification
const axios = require("axios"); // Import axios for Shiprocket API

// Handle fetch import based on Node.js version
let fetch;
try {
  // For Node.js >= 18 (with built-in fetch)
  if (!globalThis.fetch) {
    fetch = require("node-fetch");
  } else {
    fetch = globalThis.fetch;
  }
} catch (error) {
  console.error("Error importing fetch:", error);
  // Fallback to node-fetch
  fetch = require("node-fetch");
}

const app = express();
const PORT = process.env.PORT || 5000;


app.use(bodyParser.json());

// Razorpay Configuration
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Nodemailer Configuration

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});


// Create Razorpay Order
app.post("/create-order", async (req, res) => {
  try {
    const { amount, currency, receipt, notes } = req.body;
    
    const options = {
      amount: amount * 100, // Convert to paise (Razorpay requires amount in smallest currency unit)
      currency: currency || "INR",
      receipt: receipt || `receipt_${Date.now()}`,
      notes: notes || {},
    };
    
    const order = await razorpay.orders.create(options);
    
    res.status(200).json({
      success: true,
      order,
      key: process.env.RAZORPAY_KEY_ID, // Send key_id to frontend for initialization
    });
  } catch (error) {
    console.error("Order creation failed:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create order",
      error: error.message,
    });
  }
});

// Verify Razorpay Payment
app.post("/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    // Verify signature
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign)
      .digest("hex");
      
    const isAuthentic = expectedSignature === razorpay_signature;
    
    if (isAuthentic) {
      // Payment verification successful
      res.status(200).json({ 
        success: true,
        message: "Payment verification successful",
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id
      });
    } else {
      // Payment verification failed
      res.status(400).json({
        success: false,
        message: "Payment verification failed",
      });
    }
  } catch (error) {
    console.error("Payment verification error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error during verification",
      error: error.message,
    });
  }
});

// Order Confirmation Email Route
// Backend: accept and render agent name
app.post("/agent_to_customer", async (req, res) => {
  const { customerEmail, orderDetails, customerDetails, productName, agentName } = req.body;

  console.log("Received order confirmation request:", { 
    customerEmail,
    agentName: agentName || orderDetails?.agentName || 'Call Center Agent',
    orderDetails: JSON.stringify(orderDetails),
    customerDetails: JSON.stringify(customerDetails),
    productName
  });

  if (!customerEmail) {
    return res.status(400).json({ success: false, message: "Customer email is required" });
  }

  const emailSubject = `Order Confirmation #${orderDetails.orderNumber}`;

  // resolve agent from either top-level or orderDetails for compatibility
  const resolvedAgentName = (orderDetails && orderDetails.agentName) || agentName || 'Call Center Agent';

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>...</head>
    <body style="margin:0; padding:0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa;">
      <table role="presentation" ...>
        <!-- Header -->
        <tr>...</tr>

        <!-- Main Content -->
        <tr>
          <td style="padding: 40px 30px;">

            <!-- Greeting -->
            <div style="margin-bottom: 30px;">
              <h2 style="color: #2c3e50; margin: 0 0 15px; font-size: 24px; font-weight: 600;">
                Hello ${customerDetails.firstName}! 👋
              </h2>
              <p style="color: #5a6c7d; line-height: 1.6; margin: 0; font-size: 16px;">
                We're excited to confirm that your order has been successfully placed and is being processed. Here are the details:
              </p>
            </div>

            <!-- Order Summary Card -->
            <div style="background: linear-gradient(145deg, #f8f9ff 0%, #e8f2ff 100%); border-radius: 12px; padding: 25px; margin-bottom: 30px; border: 1px solid #e3f2fd;">
              <div style="display: flex; align-items: center; margin-bottom: 20px;">
                <img src="https://cdn-icons-png.flaticon.com/512/3081/3081559.png" alt="Order" style="width: 24px; height: 24px; margin-right: 10px;">
                <h3 style="color: #2c3e50; margin: 0; font-size: 20px; font-weight: 600;">Order Summary</h3>
              </div>

              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #5a6c7d; font-weight: 500;">Order Number:</td>
                  <td style="padding: 8px 0; color: #2c3e50; font-weight: 700; text-align: right;">#${orderDetails.orderNumber}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #5a6c7d; font-weight: 500;">Total Amount:</td>
                  <td style="padding: 8px 0; color: #27ae60; font-weight: 700; text-align: right; font-size: 18px;">${orderDetails.currency || '₹'} ${orderDetails.totalAmount}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #5a6c7d; font-weight: 500;">Advance Paid:</td>
                  <td style="padding: 8px 0; color: #e67e22; font-weight: 700; text-align: right;">${orderDetails.currency || '₹'} ${orderDetails.Advance_Amount}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #5a6c7d; font-weight: 500;">Payment Method:</td>
                  <td style="padding: 8px 0; color: #2c3e50; font-weight: 600; text-align: right;">${orderDetails.paymentMethod}</td>
                </tr>
                <!-- NEW: Agent Name -->
                <tr>
                  <td style="padding: 8px 0; color: #5a6c7d; font-weight: 500;">Agent Name:</td>
                  <td style="padding: 8px 0; color: #2c3e50; font-weight: 700; text-align: right;">${resolvedAgentName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #5a6c7d; font-weight: 500;">Product:</td>
                  <td style="padding: 8px 0; color: #2c3e50; font-weight: 700; text-align: right;">${productName}</td>
                </tr>
              </table>
            </div>

            <!-- Products Section ... -->
            <!-- Customer & Shipping Info ... -->
            <!-- Timeline ... -->
            <!-- CTA ... -->

          </td>
        </tr>

        <!-- Footer ... -->
      </table>
    </body>
    </html>
  `;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: customerEmail,
    cc: process.env.EMAIL_USER,
    subject: emailSubject,
    html: htmlContent
  };

  try {
    console.log("Attempting to send email to:", customerEmail);
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.messageId);
    res.status(200).json({ success: true, message: "Confirmation email sent successfully!" });
  } catch (error) {
    console.error("Error sending confirmation email:", error);
    res.status(500).json({ success: false, message: "Failed to send confirmation email", error: error.message });
  }
});


// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});