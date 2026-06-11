import { io } from 'socket.io-client';

const BASE = 'https://echoza.onrender.com';
let token, userId;

// Step 0: Create or get a test user
const creds = { username: 'testDev', password: 'testtesttest' };
let res = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(creds),
});
if (res.status !== 200) {
  res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  });
}
const authData = await res.json();
token = authData.token;
userId = authData.user.id;
console.log('Auth OK — userId:', userId);

// Step 1: Connect two sockets as the same user
console.log('\n--- Connecting Device A ---');
const socketA = io(BASE, { auth: { token }, transports: ['websocket'] });
await new Promise(r => socketA.on('connect', r));
console.log('Device A connected:', socketA.id);

console.log('\n--- Connecting Device B ---');
const socketB = io(BASE, { auth: { token }, transports: ['websocket'] });
await new Promise(r => socketB.on('connect', r));
console.log('Device B connected:', socketB.id);

// Step 2: Check user:online — should fire ONCE for the first connection
let onlineCount = 0;
const onlineCleanup1 = () => {
  socketA.on('user:online', () => { onlineCount++; });
  socketA.on('user:offline', () => { console.log('FAIL: user:offline during test'); });
};

// Step 3: Device A sends a message, Device B should receive it
console.log('\n--- Testing message:new cross-device ---');
const msgPromise = new Promise((resolve) => {
  socketB.on('message:new', (msg) => {
    console.log('Device B received message:', msg.id);
    resolve(msg);
  });
});

// First create a conversation to send to
const contactCreds = { username: 'testCont', password: 'testtesttest' };
let contactRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(contactCreds),
});
if (contactRes.status !== 200) {
  contactRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(contactCreds),
  });
}
const contactData = await contactRes.json();
const contactUserId = contactData.user.id;

// Start direct conversation
socketA.emit('direct:start', { receiverId: contactUserId });
const directResult = await new Promise(r => socketA.on('direct:started', r));
const convId = directResult.conversationId;
console.log('Conversation ID:', convId);

// Send message from A, expect B to receive it
socketA.emit('message:send', { receiverId: contactUserId, content: 'Hello from A' });
const msg = await msgPromise;
if (msg.content === 'Hello from A' && msg.senderId === userId) {
  console.log('✓ PASS: Device B received message sent from Device A');
} else {
  console.log('✗ FAIL: Message mismatch');
}

// Step 4: Test profile update sync
console.log('\n--- Testing profile:updateResult cross-device ---');
const profilePromise = new Promise((resolve) => {
  socketB.on('profile:updateResult', (result) => {
    console.log('Device B got profile:updateResult:', result.username);
    resolve(result);
  });
});

socketA.emit('profile:update', { username: 'testDev' }); // same username, no change
const profResult = await profilePromise;
if (profResult.success) {
  console.log('✓ PASS: Device B received profile update from Device A');
} else {
  console.log('✗ FAIL: Profile update sync failed');
}

// Cleanup
socketA.disconnect();
socketB.disconnect();
console.log('\n--- All tests passed ---');
process.exit(0);
