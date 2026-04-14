/**
 * TrafficGuard — API Server
 * ==========================
 * Node.js backend — Port 5000
 *
 * SMS Flow:
 *   When police approves a violation →
 *   1. Fine is generated
 *   2. SMS is sent to DEFAULT_PHONE (your Twilio-verified number)
 *      with the driver's violation details from Supabase
 *   3. SMS log is saved to sms_logs table
 *   4. If high risk → warning SMS also sent
 *
 * Routes:
 *   GET  /health              — Health check
 *   GET  /violations          — List violations (?status=pending)
 *   GET  /risk-scores         — Driver risk data
 *   GET  /payments            — Payment records (?status=unpaid)
 *   GET  /sms-logs            — All SMS logs
 *   POST /create-violation    — Insert violation (called by simulator)
 *   POST /approve-violation   — Approve + fine + SMS + risk update
 *   POST /reject-violation    — Reject violation
 *   POST /pay-fine            — Mark fine as paid
 *   POST /send-warning        — Manual high-risk warning SMS
 *   POST /detect-plate        — Check if vehicle exists
 */

require('dotenv').config();

const http = require('http');
const { createClient } = require('@supabase/supabase-js');

// ============================================
// CONFIG
// ============================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PORT = process.env.PORT || 5000;

// Twilio
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || null;
const TWILIO_AUTH = process.env.TWILIO_AUTH_TOKEN || null;
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER || null;

// YOUR number — all SMS goes here during development
// This must be a Twilio-verified number on trial accounts
const DEFAULT_PHONE = process.env.DEFAULT_SMS_RECIPIENT || null;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);


// ============================================
// HELPERS
// ============================================

function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

function calculateRisk(totalSeverity, totalViolations) {
  const score = totalSeverity + (totalViolations * 2);
  let category;
  if (score <= 5) category = 'Low';
  else if (score <= 15) category = 'Medium';
  else category = 'High';
  return { score, category };
}


// ============================================
// TWILIO SMS
// ============================================

/**
 * Send SMS via Twilio.
 *
 * IMPORTANT: On Twilio trial accounts, you can ONLY send to verified numbers.
 * So we always send to DEFAULT_PHONE (your number) regardless of the driver's
 * actual phone. The SMS body contains the driver's details from Supabase.
 *
 * Once you upgrade Twilio, change recipientPhone to the driver's actual number.
 */
async function sendSMS(driverPhone, body, metadata = {}) {
  // The actual recipient — your verified number during development
  const recipientPhone = DEFAULT_PHONE || driverPhone;

  const logEntry = {
    phone_number: driverPhone,           // driver's phone (from Supabase)
    sent_to: recipientPhone,             // actual recipient (your number)
    message_type: metadata.type || 'general',
    message_body: body,
    vehicle_id: metadata.vehicle_id || null,
    violation_record_id: metadata.violation_record_id || null,
  };

  // ── Try Twilio ──
  if (TWILIO_SID && TWILIO_AUTH && TWILIO_FROM && recipientPhone) {
    try {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;

      const params = new URLSearchParams({
        To: recipientPhone,
        From: TWILIO_FROM,
        Body: body
      });

      const authHeader = 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_AUTH}`).toString('base64');

      const resp = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });

      const result = await resp.json();

      if (result.sid) {
        logEntry.status = 'sent';
        logEntry.twilio_sid = result.sid;
        await supabase.from('sms_logs').insert(logEntry);

        console.log(`\n  📱 SMS SENT via Twilio`);
        console.log(`     To: ${recipientPhone} (driver: ${driverPhone})`);
        console.log(`     SID: ${result.sid}`);
        console.log(`     Type: ${metadata.type}`);

        return { success: true, method: 'twilio', sid: result.sid, sent_to: recipientPhone };
      } else {
        const errMsg = result.message || result.error_message || 'Unknown Twilio error';
        console.error(`  ❌ Twilio error: ${errMsg}`);
        logEntry.status = 'failed';
        logEntry.error_message = errMsg;
        await supabase.from('sms_logs').insert(logEntry);
        return { success: false, method: 'twilio', error: errMsg };
      }

    } catch (err) {
      console.error(`  ❌ Twilio request failed: ${err.message}`);
      logEntry.status = 'failed';
      logEntry.error_message = err.message;
      await supabase.from('sms_logs').insert(logEntry);
      return { success: false, method: 'twilio', error: err.message };
    }
  }

  // ── Simulation fallback (no Twilio creds) ──
  logEntry.status = 'simulated';
  await supabase.from('sms_logs').insert(logEntry);

  console.log(`\n  ${'─'.repeat(50)}`);
  console.log(`  📱 SMS SIMULATION (no Twilio configured)`);
  console.log(`     Driver phone: ${driverPhone}`);
  console.log(`     Would send to: ${recipientPhone || 'N/A'}`);
  console.log(`     Type: ${metadata.type || 'general'}`);
  console.log(`     Body:\n     ${body.replace(/\n/g, '\n     ')}`);
  console.log(`  ${'─'.repeat(50)}\n`);

  return { success: true, method: 'simulated' };
}


// ============================================
// SMS TEMPLATES
// ============================================

function buildFineNotice(ownerName, plate, violationName, fineAmount, riskCategory) {
  return `[TrafficGuard] Dear ${ownerName}, a violation (${violationName}) is recorded against ${plate}. Fine: Rs.${fineAmount}. Risk: ${riskCategory}. Pay within 30 days at trafficguard.tn.gov.in/pay or face legal action. - TN Traffic Police`;
}

function buildHighRiskWarning(ownerName, plate, riskScore, totalViolations) {
  return `[TrafficGuard WARNING] Dear ${ownerName}, vehicle ${plate} flagged HIGH RISK. Score: ${riskScore}, Violations: ${totalViolations}. Further offences may lead to license suspension. Drive safely. - TN Traffic Police`;
}

function buildPaymentConfirmation(ownerName, plate, amount, violationName) {
  return `[TrafficGuard] Dear ${ownerName}, payment of Rs.${amount} for ${violationName} (${plate}) received. Thank you. Drive safely. - TN Traffic Police`;
}


// ============================================
// ROUTE HANDLERS
// ============================================

// GET /health
async function healthCheck(req, res) {
  const twilioConfigured = !!(TWILIO_SID && TWILIO_AUTH && TWILIO_FROM);
  sendJSON(res, 200, {
    status: 'ok',
    server: 'TrafficGuard API',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    sms_mode: twilioConfigured ? 'twilio' : 'simulation',
    default_recipient: DEFAULT_PHONE ? DEFAULT_PHONE.replace(/.(?=.{4})/g, '*') : 'not set',
    twilio_from: TWILIO_FROM ? TWILIO_FROM.replace(/.(?=.{4})/g, '*') : 'not set'
  });
}


// POST /create-violation
async function createViolation(req, res) {
  const body = await parseBody(req);
  const {
    plate_number, owner_name, phone_number,
    violation_id, detected_by_ai = false, evidence_url = null
  } = body;

  if (!plate_number || !violation_id) {
    return sendJSON(res, 400, { error: 'plate_number and violation_id are required' });
  }

  const { data: violationMaster, error: vmErr } = await supabase
    .from('violations_master')
    .select('*')
    .eq('id', violation_id)
    .single();

  if (vmErr || !violationMaster) {
    return sendJSON(res, 404, { error: 'Violation type not found' });
  }

  const { data: vehicle, error: vehicleErr } = await supabase
    .from('vehicles')
    .upsert(
      {
        plate_number: plate_number.toUpperCase(),
        owner_name: owner_name || 'Unknown',
        phone_number: phone_number || ''
      },
      { onConflict: 'plate_number', ignoreDuplicates: false }
    )
    .select()
    .single();

  if (vehicleErr) {
    return sendJSON(res, 500, { error: 'Failed to upsert vehicle', detail: vehicleErr.message });
  }

  const { data: record, error: recErr } = await supabase
    .from('violation_records')
    .insert({
      vehicle_id: vehicle.id,
      violation_id,
      detected_by_ai,
      status: 'pending',
      fine_amount: violationMaster.fine_amount,
      evidence_url
    })
    .select()
    .single();

  if (recErr) {
    return sendJSON(res, 500, { error: 'Failed to create violation record', detail: recErr.message });
  }

  await supabase.from('payments').insert({
    violation_record_id: record.id,
    amount: violationMaster.fine_amount,
    payment_status: 'unpaid'
  });

  console.log(`  [NEW] ${plate_number} — ${violationMaster.violation_name} — ₹${violationMaster.fine_amount} — pending`);

  sendJSON(res, 201, {
    success: true,
    message: 'Violation created — pending officer approval',
    record_id: record.id,
    violation: violationMaster.violation_name,
    fine: violationMaster.fine_amount,
    status: 'pending'
  });
}


// POST /approve-violation
// Officer approves → fine generated → SMS sent to YOUR number → risk updated
async function approveViolation(req, res) {
  const { record_id, officer_id } = await parseBody(req);
  if (!record_id) return sendJSON(res, 400, { error: 'record_id required' });

  // 1. Get violation record with vehicle + violation type
  const { data: record, error: recErr } = await supabase
    .from('violation_records')
    .select('*, vehicles(*), violations_master(*)')
    .eq('id', record_id)
    .single();

  if (recErr || !record) return sendJSON(res, 404, { error: 'Violation record not found' });
  if (record.status !== 'pending') return sendJSON(res, 400, { error: `Already ${record.status}` });

  // 2. Approve
  await supabase
    .from('violation_records')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: officer_id || null
    })
    .eq('id', record_id);

  // 3. Recalculate risk score from all approved violations for this vehicle
  const vehicleId = record.vehicle_id;
  const { data: approvedViolations } = await supabase
    .from('violation_records')
    .select('violation_id, violations_master(severity_weight)')
    .eq('vehicle_id', vehicleId)
    .eq('status', 'approved');

  const totalSeverity = (approvedViolations || []).reduce(
    (sum, v) => sum + (v.violations_master?.severity_weight || 0), 0
  );
  const totalViolations = (approvedViolations || []).length;
  const { score, category } = calculateRisk(totalSeverity, totalViolations);

  // 4. Update vehicle risk
  await supabase
    .from('vehicles')
    .update({
      risk_score: score,
      risk_category: category,
      total_violations: totalViolations,
      updated_at: new Date().toISOString()
    })
    .eq('id', vehicleId);

  // 5. Log risk prediction
  await supabase.from('risk_predictions').insert({
    vehicle_id: vehicleId,
    predicted_score: score,
    predicted_category: category,
    features: { total_severity: totalSeverity, total_violations: totalViolations }
  });

  // 6. Send Fine Notice SMS
  //    SMS goes to DEFAULT_PHONE (your number) but body contains driver details from Supabase
  const fineMsg = buildFineNotice(
    record.vehicles.owner_name,
    record.vehicles.plate_number,
    record.violations_master.violation_name,
    record.fine_amount,
    category
  );

  console.log(`\n  ✅ APPROVED: ${record.vehicles.plate_number} — ${record.violations_master.violation_name}`);
  console.log(`     Fine: ₹${record.fine_amount} | Risk: ${category} (${score})`);

  const smsResult = await sendSMS(
    record.vehicles.phone_number,  // driver's phone from Supabase
    fineMsg,
    {
      type: 'fine_notice',
      vehicle_id: vehicleId,
      violation_record_id: record.id
    }
  );

  // 7. If HIGH RISK → also send warning
  let warningSent = false;
  if (category === 'High') {
    const warningMsg = buildHighRiskWarning(
      record.vehicles.owner_name,
      record.vehicles.plate_number,
      score,
      totalViolations
    );

    await sendSMS(
      record.vehicles.phone_number,
      warningMsg,
      {
        type: 'warning',
        vehicle_id: vehicleId,
        violation_record_id: record.id
      }
    );
    warningSent = true;
  }

  sendJSON(res, 200, {
    success: true,
    message: 'Violation approved — fine issued — SMS sent',
    record_id,
    fine_amount: record.fine_amount,
    risk_score: score,
    risk_category: category,
    sms_sent: smsResult.success,
    sms_method: smsResult.method,
    sms_sent_to: smsResult.sent_to || DEFAULT_PHONE || 'simulated',
    warning_sent: warningSent
  });
}


// POST /reject-violation
async function rejectViolation(req, res) {
  const { record_id, reason } = await parseBody(req);
  if (!record_id) return sendJSON(res, 400, { error: 'record_id required' });

  await supabase
    .from('violation_records')
    .update({ status: 'rejected', notes: reason || 'Rejected by officer' })
    .eq('id', record_id);

  console.log(`  ❌ REJECTED: ${record_id} — ${reason || 'No reason'}`);

  sendJSON(res, 200, { success: true, message: 'Violation rejected' });
}


// POST /pay-fine
async function payFine(req, res) {
  const { record_id, payment_method = 'online' } = await parseBody(req);
  if (!record_id) return sendJSON(res, 400, { error: 'record_id required' });

  const { data: payment, error: payErr } = await supabase
    .from('payments')
    .select('*, violation_records(*, vehicles(*), violations_master(*))')
    .eq('violation_record_id', record_id)
    .single();

  if (payErr || !payment) return sendJSON(res, 404, { error: 'Payment record not found' });
  if (payment.payment_status === 'paid') return sendJSON(res, 400, { error: 'Already paid' });

  await supabase
    .from('payments')
    .update({ payment_status: 'paid', paid_at: new Date().toISOString(), payment_method })
    .eq('id', payment.id);

  // Send payment confirmation SMS
  const vr = payment.violation_records;
  if (vr && vr.vehicles) {
    const confirmMsg = buildPaymentConfirmation(
      vr.vehicles.owner_name,
      vr.vehicles.plate_number,
      payment.amount,
      vr.violations_master?.violation_name || 'Traffic Violation'
    );
    await sendSMS(vr.vehicles.phone_number, confirmMsg, {
      type: 'payment_confirmation',
      vehicle_id: vr.vehicle_id,
      violation_record_id: record_id
    });
  }

  sendJSON(res, 200, { success: true, message: 'Payment recorded', record_id, amount: payment.amount });
}


// GET /payments
async function getPayments(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const status = url.searchParams.get('status');

  let query = supabase
    .from('payments')
    .select('*, violation_records(*, vehicles(plate_number, owner_name), violations_master(violation_name))');
  if (status) query = query.eq('payment_status', status);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return sendJSON(res, 500, { error: error.message });
  sendJSON(res, 200, { payments: data, count: (data || []).length });
}


// GET /sms-logs
async function getSMSLogs(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const type = url.searchParams.get('type');     // fine_notice, warning, payment_confirmation
  const status = url.searchParams.get('status'); // sent, simulated, failed

  let query = supabase.from('sms_logs').select('*');
  if (type) query = query.eq('message_type', type);
  if (status) query = query.eq('status', status);

  const { data, error } = await query.order('sent_at', { ascending: false }).limit(100);
  if (error) return sendJSON(res, 500, { error: error.message });
  sendJSON(res, 200, { sms_logs: data, count: (data || []).length });
}


// POST /send-warning (manual)
async function sendWarning(req, res) {
  const { vehicle_id } = await parseBody(req);
  if (!vehicle_id) return sendJSON(res, 400, { error: 'vehicle_id required' });

  const { data: vehicle } = await supabase
    .from('vehicles').select('*').eq('id', vehicle_id).single();
  if (!vehicle) return sendJSON(res, 404, { error: 'Vehicle not found' });

  const msg = buildHighRiskWarning(
    vehicle.owner_name, vehicle.plate_number,
    vehicle.risk_score, vehicle.total_violations
  );

  const smsResult = await sendSMS(vehicle.phone_number, msg, {
    type: 'warning', vehicle_id: vehicle.id
  });

  sendJSON(res, 200, { success: true, sms_method: smsResult.method, sms_body: msg });
}


// GET /violations
async function getViolations(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const status = url.searchParams.get('status');

  let query = supabase.from('violation_details').select('*');
  if (status) query = query.eq('status', status);

  const { data, error } = await query.order('detected_at', { ascending: false });
  if (error) return sendJSON(res, 500, { error: error.message });
  sendJSON(res, 200, { violations: data, count: (data || []).length });
}


// GET /risk-scores
async function getRiskScores(req, res) {
  const { data, error } = await supabase
    .from('vehicles')
    .select('plate_number, owner_name, phone_number, total_violations, risk_score, risk_category')
    .order('risk_score', { ascending: false });
  if (error) return sendJSON(res, 500, { error: error.message });
  sendJSON(res, 200, { drivers: data });
}


// POST /detect-plate
async function detectPlate(req, res) {
  const { plate_number, confidence = 0.0 } = await parseBody(req);
  if (!plate_number) return sendJSON(res, 400, { error: 'plate_number required' });

  const { data: vehicle } = await supabase
    .from('vehicles').select('*').eq('plate_number', plate_number.toUpperCase()).single();

  sendJSON(res, 200, {
    plate_number: plate_number.toUpperCase(),
    confidence,
    vehicle_exists: !!vehicle,
    vehicle: vehicle || null
  });
}


// ============================================
// ROUTER
// ============================================

const ROUTES = {
  'GET /health':             healthCheck,
  'GET /violations':         getViolations,
  'GET /risk-scores':        getRiskScores,
  'GET /payments':           getPayments,
  'GET /sms-logs':           getSMSLogs,
  'POST /detect-plate':      detectPlate,
  'POST /create-violation':  createViolation,
  'POST /approve-violation': approveViolation,
  'POST /reject-violation':  rejectViolation,
  'POST /pay-fine':          payFine,
  'POST /send-warning':      sendWarning,
};

const server = http.createServer(async (req, res) => {
  setCORSHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const urlPath = req.url.split('?')[0];
  const routeKey = `${req.method} ${urlPath}`;
  const handler = ROUTES[routeKey];

  if (!handler) return sendJSON(res, 404, { error: `Route not found: ${routeKey}` });

  try {
    await handler(req, res);
  } catch (err) {
    console.error('[ERROR]', err);
    sendJSON(res, 500, { error: 'Internal server error', detail: err.message });
  }
});

server.listen(PORT, () => {

  const twilioOk = !!(TWILIO_SID && TWILIO_AUTH && TWILIO_FROM);
  console.log(`\n🛡  TrafficGuard API Server v2.0`);
  console.log(`   Port: ${PORT}`);
  console.log(`   SMS:  ${twilioOk ? '✅ Twilio LIVE' : '⚠  Simulation (set TWILIO vars in .env)'}`);
  console.log(`   Send to: ${DEFAULT_PHONE || '⚠  DEFAULT_SMS_RECIPIENT not set'}`);
  console.log(`   Routes:`);
  Object.keys(ROUTES).forEach(r => console.log(`     ${r}`));
  console.log();
  console.log('DEBUG ENV:', {
  SID: TWILIO_SID ? 'set' : 'MISSING',
  AUTH: TWILIO_AUTH ? 'set' : 'MISSING',
  FROM: TWILIO_FROM,
  TO: DEFAULT_PHONE
});
});