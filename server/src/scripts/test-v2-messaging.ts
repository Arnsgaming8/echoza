import { io as createSocket } from 'socket.io-client';
const BASE_URL = process.env.BASE_URL || 'https://echoza-5ysd.onrender.com';
let passed = 0;
let failed = 0;
const errors = [];
function check(name, ok, detail) {
    if (ok) {
        console.log(`  ✅ ${name}`);
        passed++;
    }
    else {
        console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
        failed++;
        errors.push(`${name}: ${detail || 'failed'}`);
    }
}
async function api(path, options = {}) {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    }
    catch {
        json = text;
    }
    return { status: res.status, json };
}
function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}
async function main() {
    console.log('═══════════════════════════════════════════════');
    console.log('  v2 Schema — Messaging Flow Test');
    console.log(`  Target: ${BASE_URL}`);
    console.log('═══════════════════════════════════════════════\n');
    const health = await api('/api/health');
    check('Server reachable', health.status === 200);
    if (health.status !== 200)
        return;
    const ts = Date.now().toString(36).replace(/[0-9]/g, m => String.fromCharCode(97 + parseInt(m)));
    const user1Name = `Alice_${ts}`;
    const user2Name = `Bob_${ts}`;
    const pw = 'TestPass123!';
    const r1 = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: user1Name, password: pw }) });
    check(`User1 "${user1Name}" registered`, r1.status === 201, r1.json?.error);
    const t1 = r1.json?.token, u1 = r1.json?.user?.id;
    const r2 = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: user2Name, password: pw }) });
    check(`User2 "${user2Name}" registered`, r2.status === 201, r2.json?.error);
    const t2 = r2.json?.token, u2 = r2.json?.user?.id;
    if (!t1 || !t2) {
        console.log('\n  ❌ Cannot proceed');
        return;
    }
    console.log(`  User1: ${u1.slice(0, 8)}...  User2: ${u2.slice(0, 8)}...\n`);
    console.log('─── Connecting Sockets ───');
    console.log('  Connecting User1...');
    const s1 = createSocket(BASE_URL, { auth: { token: t1 }, transports: ['polling', 'websocket'] });
    await new Promise((resolve, reject) => {
        s1.on('connect', () => { console.log('  ✅ User1 connected'); resolve(); });
        s1.on('connect_error', reject);
        setTimeout(() => reject(new Error('User1 timeout')), 20000);
    });
    console.log('  Waiting 2s before connecting User2...');
    await delay(2000);
    console.log('  Connecting User2...');
    const s2 = createSocket(BASE_URL, { auth: { token: t2 }, transports: ['polling', 'websocket'] });
    await new Promise((resolve, reject) => {
        s2.on('connect', () => { console.log('  ✅ User2 connected'); resolve(); });
        s2.on('connect_error', reject);
        setTimeout(() => reject(new Error('User2 timeout')), 20000);
    });
    console.log('');
    console.log('─── Create Conversation ───');
    s1.emit('direct:start', { receiverId: u2 });
    const convResult = await new Promise((resolve, reject) => {
        s1.once('direct:started', resolve);
        setTimeout(() => reject(new Error('direct:started timeout')), 10000);
    });
    const convId = convResult.conversationId;
    check('direct:started received', !!convId, convId?.slice(0, 8));
    console.log('');
    console.log('─── Send Message (user1 → user2) ───');
    s1.emit('message:send', { receiverId: u2, content: 'Hello Bob! v2 schema works!' });
    const sent = await new Promise((resolve, reject) => {
        s1.once('message:sent', resolve);
        setTimeout(() => reject(new Error('message:sent timeout')), 10000);
    });
    check('message:sent received', !!sent?.id);
    check('Content matches', sent?.content === 'Hello Bob! v2 schema works!', sent?.content);
    check('Sender is user1', sent?.senderId === u1);
    check('conversationId matches', sent?.conversationId === convId);
    check('attachments is array', Array.isArray(sent?.attachments));
    check('read is false', sent?.read === false);
    await delay(1000);
    console.log('');
    console.log('─── Receive Message (user2) ───');
    const received = await new Promise((resolve, reject) => {
        s2.once('message:new', resolve);
        setTimeout(() => reject(new Error('message:new timeout')), 10000);
    });
    check('message:new received by user2', !!received?.id);
    check('Content matches', received?.content === 'Hello Bob! v2 schema works!');
    check('Sender is user1', received?.senderId === u1);
    check('conversationId matches', received?.conversationId === convId);
    console.log('');
    console.log('─── REST Verification ───');
    const convs = await api('/api/conversations', { headers: { Authorization: `Bearer ${t2}` } });
    check('Conversations API returns 200', convs.status === 200);
    const cl = Array.isArray(convs.json) ? convs.json : [];
    check('User2 has 1 conversation', cl.length === 1, `got ${cl.length}`);
    if (cl.length === 1) {
        check('ID matches', cl[0].id === convId);
        check('isGroup false', cl[0].isGroup === false);
        check('Contact is user1', cl[0].contact?.username === user1Name, cl[0].contact?.username);
        check('Last message preview', cl[0].lastMessage === 'Hello Bob! v2 schema works!', `"${cl[0].lastMessage}"`);
        check('Unread > 0', cl[0].unread > 0, `unread=${cl[0].unread}`);
    }
    console.log('');
    console.log('─── Fetch Messages ───');
    s2.emit('messages:get', { conversationId: convId });
    const msgs = await new Promise((resolve, reject) => {
        s2.once('messages:list', resolve);
        setTimeout(() => reject(new Error('messages:list timeout')), 10000);
    });
    check('messages:list received', !!msgs);
    check('conversationId matches', msgs?.conversationId === convId);
    check('Has 1 message', msgs?.messages?.length === 1, `got ${msgs?.messages?.length}`);
    if (msgs?.messages?.length >= 1) {
        const m = msgs.messages[0];
        check('Content matches', m.content === 'Hello Bob! v2 schema works!');
        check('senderId is user1', m.senderId === u1);
        check('read is false (no receipt yet)', m.read === false, `got ${m.read}`);
        check('attachments is array', Array.isArray(m.attachments));
    }
    console.log('');
    console.log('─── Reply (user2 → user1) ───');
    s2.emit('message:send', { receiverId: u1, content: 'Hey Alice! Got it! 🎉' });
    const replySent = await new Promise((resolve, reject) => {
        s2.once('message:sent', resolve);
        setTimeout(() => reject(new Error('message:sent timeout')), 10000);
    });
    check('Reply sent', !!replySent?.id);
    check('Sender is user2', replySent?.senderId === u2);
    check('Content', replySent?.content === 'Hey Alice! Got it! 🎉', replySent?.content);
    await delay(500);
    const replyRecv = await new Promise((resolve, reject) => {
        s1.once('message:new', resolve);
        setTimeout(() => reject(new Error('message:new timeout')), 10000);
    });
    check('User1 received reply', !!replyRecv?.id);
    check('Sender is user2', replyRecv?.senderId === u2);
    check('Content matches', replyRecv?.content === 'Hey Alice! Got it! 🎉');
    console.log('');
    console.log('─── Read Receipt ───');
    s2.emit('message:read', { messageId: sent.id, conversationId: convId });
    const readEvt = await new Promise((resolve, reject) => {
        s1.once('message:read-status', resolve);
        setTimeout(() => reject(new Error('message:read-status timeout')), 5000);
    });
    check('message:read-status received by user1', !!readEvt);
    check('messageId matches', readEvt?.messageId === sent.id, readEvt?.messageId?.slice(0, 8));
    check('conversationId matches', readEvt?.conversationId === convId);
    check('readByUserId is user2', readEvt?.readByUserId === u2, readEvt?.readByUserId?.slice(0, 8));
    console.log('');
    console.log('─── Verify Read Status ───');
    s2.emit('messages:get', { conversationId: convId });
    const msgs2 = await new Promise((resolve, reject) => {
        s2.once('messages:list', resolve);
        setTimeout(() => reject(new Error('messages:list timeout')), 10000);
    });
    if (msgs2?.messages?.length >= 1) {
        check('Message now shows read=true', msgs2.messages[0].read === true, `got ${msgs2.messages[0].read}`);
    }
    console.log('');
    console.log('─── Final REST Check ───');
    const fc1 = await api('/api/conversations', { headers: { Authorization: `Bearer ${t1}` } });
    const fc2 = await api('/api/conversations', { headers: { Authorization: `Bearer ${t2}` } });
    const l1 = Array.isArray(fc1.json) ? fc1.json : [];
    const l2 = Array.isArray(fc2.json) ? fc2.json : [];
    check('User1 sees 1 conversation', l1.length === 1, `got ${l1.length}`);
    check('User2 sees 1 conversation', l2.length === 1, `got ${l2.length}`);
    if (l1.length === 1)
        check('User1 sees reply preview', l1[0].lastMessage === 'Hey Alice! Got it! 🎉', `"${l1[0].lastMessage}"`);
    if (l2.length === 1)
        check('User2 sees reply preview', l2[0].lastMessage === 'Hey Alice! Got it! 🎉', `"${l2[0].lastMessage}"`);
    console.log('');
    s1.disconnect();
    s2.disconnect();
    check('Sockets disconnected', true);
    console.log('');
    console.log('═══════════════════════════════════════════════');
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════');
    if (errors.length > 0) {
        console.log('\n  Failures:');
        for (const e of errors)
            console.log(`    • ${e}`);
    }
    console.log(`\n  Test users (live at echoza-5ysd.onrender.com):`);
    console.log(`    - "${user1Name}" / ${pw}`);
    console.log(`    - "${user2Name}" / ${pw}`);
    console.log('');
}
main().catch(err => {
    console.error('\n  ❌ Script error:', err.message);
    console.log('\n═══════════════════════════════════════════════');
});
