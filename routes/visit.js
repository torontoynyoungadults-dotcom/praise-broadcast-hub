/** /visit — 화면이 보내는 방문 기록 (public/js/visit.js). 로그인한 사람만 받음 */
'use strict';
const express = require('express');
const sheetsDb = require('../lib/sheetsDb');
const visitLog = require('../lib/visitLog');

const router = express.Router();
router.post('/visit', express.text({ type: '*/*', limit: '8kb' }), async (req, res) => {
  res.status(204).end();
  if (!req.session || !req.session.email) return;
  let list = [];
  try { const b = typeof req.body === 'string' ? JSON.parse(req.body || '[]') : req.body; list = Array.isArray(b) ? b : [b]; } catch (e) { return; }
  try {
    const m = await sheetsDb.findOne('회원', '이메일', req.session.email);
    const name = (m && String(m['이름'] || '').trim()) || req.session.email;
    list.slice(0, 10).forEach((e) => visitLog.add(Object.assign({}, e, { email: req.session.email, name })));
  } catch (e) { /* 기록은 놓쳐도 됨 */ }
});
module.exports = router;
