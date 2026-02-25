// Add this temporary route to your Express app
app.get('/api/test-razorpay', async (req, res) => {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  // 1. Check if keys exist in the environment
  if (!key_id || !key_secret) {
    return res.status(500).json({
      success: false,
      error: "Missing Razorpay keys in environment variables.",
      found_id: !!key_id,
      found_secret: !!key_secret
    });
  }

  try {
    // 2. Try a real (but small) API call to Razorpay
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${key_id}:${key_secret}`),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: 100, // 1 INR
        currency: "INR",
        receipt: "test_receipt_1"
      })
    });

    const data = await response.json();

    if (response.ok) {
      return res.json({ success: true, message: "Authentication successful!", order_id: data.id });
    } else {
      return res.status(response.status).json({
        success: false,
        error: "Razorpay rejected the keys.",
        details: data.error
      });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
