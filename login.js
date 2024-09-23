const express = require('express');
const axios = require('axios');
const qs = require('qs');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 1233;

let authorizedUsers = {};

const generateRandomKey = () => Math.random().toString(36).substring(2, 10);

// CORS middleware to allow requests from your front-end origin
app.use(cors({
    origin: 'https://fortnite-spoofer.netlify.app',
    methods: ['GET', 'POST'],
    credentials: true // If you need to send cookies or authorization headers
}));

const getAccessTokenFromDevice = async (accountId, deviceId, secret) => {
    const response = await axios.post(
        "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token",
        new URLSearchParams({
            grant_type: 'device_auth',
            account_id: accountId,
            device_id: deviceId,
            secret: secret,
            token_type: 'eg1'
        }),
        {
            headers: {
                'Authorization': 'Basic OThmN2U0MmMyZTNhNGY4NmE3NGViNDNmYmI0MWVkMzk6MGEyNDQ5YTItMDAxYS00NTFlLWFmZWMtM2U4MTI5MDFjNGQ3',
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );
    return response.data.access_token;
};

app.get('/deviceAuth', async (req, res) => {
    try {
        const key = generateRandomKey();
        
        // Get initial access token
        const tokenResponse = await axios.post('https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token', qs.stringify({
            grant_type: 'client_credentials'
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic OThmN2U0MmMyZTNhNGY4NmE3NGViNDNmYmI0MWVkMzk6MGEyNDQ5YTItMDAxYS00NTFlLWFmZWMtM2U4MTI5MDFjNGQ3'
            }
        });

        const accessToken = tokenResponse.data.access_token;

        // Device authorization request
        const deviceAuthResponse = await axios.post('https://account-public-service-prod.ol.epicgames.com/account/api/oauth/deviceAuthorization', {
            prompt: 'login'
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const { device_code, user_code } = deviceAuthResponse.data;
        authorizedUsers[key] = { status: 'pending' };

        res.json({
            message: 'Please log in using the following link and user code',
            link: `https://www.epicgames.com/id/activate?userCode=${user_code}`,
            refresh_link: `https://${process.env.HOST}/getDeviceInfo?key=${key}`,
            user_code: user_code.toString()
        });

        // Polling for login status
        let pollInterval = setInterval(async () => {
            try {
                const pollResponse = await axios.post('https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token', qs.stringify({
                    grant_type: 'device_code',
                    device_code,
                    token_type: 'eg1'
                }), {
                    headers: {
                        'Authorization': 'Basic OThmN2U0MmMyZTNhNGY4NmE3NGViNDNmYmI0MWVkMzk6MGEyNDQ5YTItMDAxYS00NTFlLWFmZWMtM2U4MTI5MDFjNGQ3',
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                });

                if (pollResponse.data.access_token) {
                    clearInterval(pollInterval);
                    const loggedInData = pollResponse.data;
                    const accountId = loggedInData.account_id;

                    const exchangeResponse = await axios.post(`https://account-public-service-prod.ol.epicgames.com/account/api/public/account/${accountId}/deviceAuth`, {}, {
                        headers: { Authorization: `Bearer ${loggedInData.access_token}`, 'Content-Type': 'application/json' }
                    });

                    const { deviceId, secret } = exchangeResponse.data;

                    authorizedUsers[key] = {
                        access_token: loggedInData.access_token,
                        account_id: accountId,
                        device_id: deviceId,
                        secret: secret,
                        display_name: loggedInData.displayName
                    };

                    console.log(`User ${accountId} authorized successfully.`);

                    if (!res.headersSent) {
                        res.json({
                            success: true,
                            message: 'Authorization successful. You can now get your device info using the refresh link.',
                            refresh_link: `https://${process.env.HOST}/getDeviceInfo?key=${key}`
                        });
                    }
                }
            } catch (error) {
                if (error.response && error.response.status === 400) {
                    console.log('Waiting for user to authorize device...');
                } else {
                    clearInterval(pollInterval);
                    console.error('Error:', error.response ? error.response.data : error);
                    if (!res.headersSent) {
                        res.status(500).json({ success: false, message: 'Error processing the request.' });
                    }
                }
            }
        }, 1000); // Poll every 10 seconds
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Error processing the request.' });
        }
    }
});

app.get('/getDeviceInfo', (req, res) => {
    const key = req.query.key;

    if (!key) {
        return res.status(400).json({ error: 'key is required.' });
    }

    const userInfo = authorizedUsers[key];

    if (userInfo) {
        res.json({ success: true, data: userInfo });
    } else {
        res.status(404).json({ success: false, message: 'User not found or not authorized yet.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on https://${process.env.HOST}:${PORT}`);
});
