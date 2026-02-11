# Razorpay Multi-Currency Test Plan

## Changes Made

1. **Frontend:**
   - Updated `paymentPlatform.js` to use Razorpay for all regions (India + US)
   - Added `getUserRegion()` function to detect currency based on timezone/locale
   - Updated `razorpayManager.js` to accept `userRegion` parameter
   - Updated `ResultScreen.jsx` to pass region info to payment handler

2. **Backend:**
   - Modified `/api/payment/create-order` to support both INR and USD
   - Pricing: India = ₹49, US = $4.99 (or ₹1/$0.01 in dev mode)

## Test Cases

### Test 1: India Region (INR)
**Setup:** User in India timezone (Asia/Kolkata)
**Expected:**
- Button shows: "Download for ₹49"
- Razorpay order created with currency=INR, amount=4900 paise
- Payment modal opens with ₹49 charge

### Test 2: US Region (USD)
**Setup:** User in US timezone (America/New_York)
**Expected:**
- Button shows: "Download for $4.99"
- Razorpay order created with currency=USD, amount=499 cents
- Payment modal opens with $4.99 charge

### Test 3: Dev Mode Bypass
**Setup:** Venue = "Hotel Jain Ji Shubham"
**Expected:**
- Button shows: "Download for ₹1" or "$0.01"
- Order created with minimal amount

## Manual Testing Steps

1. **Start backend:**
   ```bash
   cd backend
   npm run dev
   ```

2. **Start frontend:**
   ```bash
   cd frontend
   npm run dev
   ```

3. **Test India region:**
   - Open Chrome DevTools → Settings → Sensors
   - Set timezone to "Asia/Kolkata"
   - Generate invite
   - Click download button
   - Verify: Button shows ₹49, Razorpay modal opens with INR

4. **Test US region:**
   - Set timezone to "America/New_York"
   - Generate new invite
   - Click download button
   - Verify: Button shows $4.99, Razorpay modal opens with USD

5. **Check backend logs:**
   ```
   Should see: "Creating payment order" with correct currency and amount
   ```

## Verification Checklist

- [ ] Backend has RAZORPAY_KEY_ID and RAZORPAY_SECRET in .env
- [ ] Frontend has VITE_RAZORPAY_ENABLED=true
- [ ] India users see ₹49 pricing
- [ ] US users see $4.99 pricing
- [ ] Payment modal opens successfully
- [ ] Payment verification works for both currencies
- [ ] Backend logs show correct currency and amount
- [ ] Download triggers after successful payment

## Known Issues to Watch For

1. **Timezone Detection:** Some browsers may block timezone access
   - Fallback: Defaults to USD for safety
2. **Razorpay USD Support:** Ensure your Razorpay account supports international payments
3. **Test Mode:** Use test keys for development (rzp_test_*)
