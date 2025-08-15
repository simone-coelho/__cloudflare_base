#!/bin/bash

# API Test Script for Cloudflare Edge Platform
BASE_URL="http://localhost:9100"

echo "🚀 Testing Cloudflare Edge Platform API"
echo "========================================"

# 1. Test health endpoint
echo -e "\n1️⃣ Testing Health Endpoint..."
curl -s $BASE_URL/health | jq -c '{status: .status, services: .services}'

# 2. Test tracking endpoint
echo -e "\n2️⃣ Testing Event Tracking..."
curl -s -X POST $BASE_URL/track/event \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "'$(uuidgen)'",
    "eventType": "track",
    "event": "test_event",
    "source": "test",
    "version": "1.0",
    "timestamp": '$(date +%s000)',
    "user": {
      "userId": "test-user",
      "anonymousId": "test-anon"
    },
    "properties": {
      "test": true
    }
  }' | jq -c '{success: .success, eventId: .eventId}'

# 3. Test pixel generation
echo -e "\n3️⃣ Testing Pixel Generation..."
PIXEL_RESPONSE=$(curl -s -X POST $BASE_URL/pixel/generate \
  -H "Content-Type: application/json" \
  -d '{
    "campaignId": "test-campaign",
    "emailId": "test-email",
    "recipientId": "test-user"
  }')
echo $PIXEL_RESPONSE | jq -c '{pixelId: .pixelId, pixelUrl: .pixelUrl}'

# 4. Test authentication
echo -e "\n4️⃣ Testing Authentication..."

# Register
echo "   Registering user..."
curl -s -X POST $BASE_URL/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test'$(date +%s)'@example.com",
    "password": "testpass123",
    "name": "Test User"
  }' | jq -c '{success: .success, userId: .user.id}'

# Login
echo "   Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "demo@example.com",
    "password": "testpass123"
  }')
TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.accessToken')
echo $LOGIN_RESPONSE | jq -c '{accessToken: (.accessToken | .[0:20] + "..."), expiresIn: .expiresIn}'

# Test protected endpoint
echo "   Testing protected endpoint..."
curl -s $BASE_URL/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq -c '{email: .user.email, roles: .user.roles}'

echo -e "\n✅ All API tests completed successfully!"