

// Load env
require('dotenv').config();

const http = require('http');
const { createClient } = require('@supabase/supabase-js');


const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PORT = process.env.PORT || 5000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function calculateRisk(totalSeverity, totalViolations) {
  const score = totalSeverity + (totalViolations * 2);
  let category;
  if (score <= 5) category = 'Low';
  else if (score <= 15) category = 'Medium';
  else category = 'High';
  return { score, category };
}

//json helpers
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



// GET /health
async function healthCheck(req, res) {
  sendJSON(res, 200, {
    status: 'ok',
    server: 'TrafficGuard API',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
}

// POST /detect-plate
// Body: { plate_number: 'TN09AB1234', confidence: 0.95 }
// Returns: plate info or creates vehicle
async function detectPlate(req, res) {
  const { plate_number, confidence = 0.0 } = await parseBody(req);
  if (!plate_number) return sendJSON(res, 400, { error: 'plate_number required' });

  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('plate_number', plate_number.toUpperCase())
    .single();

  sendJSON(res, 200, {
    plate_number: plate_number.toUpperCase(),
    confidence,
    vehicle_exists: !!vehicle,
    vehicle: vehicle || null
  });
}

// POST /create-violation
// Body: { plate_number, owner_name, phone_number, violation_id, detected_by_ai, evidence_url }
async function createViolation(req, res) {
  const body = await parseBody(req);
  const { plate_number, owner_name, phone_number, violation_id, detected_by_ai = false, evidence_url = null } = body;

  if (!plate_number || !violation_id) {
    return sendJSON(res, 400, { error: 'plate_number and violation_id are required' });
  }

  // Get violation master info
  const { data: violationMaster, error: vmErr } = await supabase
    .from('violations_master')
    .select('*')
    .eq('id', violation_id)
    .single();

  if (vmErr || !violationMaster) {
    return sendJSON(res, 404, { error: 'Violation type not found' });
  }

  // Upsert vehicle (create if not exists)
  const { data: vehicle, error: vehicleErr } = await supabase
    .from('vehicles')
    .upsert(
      { plate_number: plate_number.toUpperCase(), owner_name: owner_name || 'Unknown', phone_number: phone_number || '' },
      { onConflict: 'plate_number', ignoreDuplicates: false }
    )
    .select()
    .single();

  if (vehicleErr) {
    return sendJSON(res, 500, { error: 'Failed to upsert vehicle', detail: vehicleErr.message });
  }

  // Insert violation record
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

  // Create pending payment entry
  await supabase.from('payments').insert({
    violation_record_id: record.id,
    amount: violationMaster.fine_amount,
    payment_status: 'unpaid'
  });

  sendJSON(res, 201, {
    success: true,
    message: 'Violation created and pending approval',
    record_id: record.id,
    violation: violationMaster.violation_name,
    fine: violationMaster.fine_amount,
    status: 'pending'
  });
}

// POST /approve-violation
// Body: { record_id, officer_id }
async function approveViolation(req, res) {
  const { record_id, officer_id } = await parseBody(req);
  if (!record_id) return sendJSON(res, 400, { error: 'record_id required' });

  // Get the violation record with vehicle info
  const { data: record, error: recErr } = await supabase
    .from('violation_records')
    .select('*, vehicles(*), violations_master(*)')
    .eq('id', record_id)
    .single();

  if (recErr || !record) {
    return sendJSON(res, 404, { error: 'Violation record not found' });
  }

  if (record.status !== 'pending') {
    return sendJSON(res, 400, { error: `Violation is already ${record.status}` });
  }

  // Approve the violation
  await supabase
    .from('violation_records')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: officer_id || null
    })
    .eq('id', record_id);

  // Recalculate risk score for this vehicle
  const vehicleId = record.vehicle_id;

  const { data: approvedViolations } = await supabase
    .from('violation_records')
    .select('violation_id, violations_master(severity_weight)')
    .eq('vehicle_id', vehicleId)
    .eq('status', 'approved');

  const totalSeverity = approvedViolations.reduce((sum, v) => sum + v.violations_master.severity_weight, 0);
  const totalViolations = approvedViolations.length;
  const { score, category } = calculateRisk(totalSeverity, totalViolations);

  // Update vehicle risk
  await supabase
    .from('vehicles')
    .update({
      risk_score: score,
      risk_category: category,
      total_violations: totalViolations,
      updated_at: new Date().toISOString()
    })
    .eq('id', vehicleId);

  // Log risk prediction
  await supabase.from('risk_predictions').insert({
    vehicle_id: vehicleId,
    predicted_score: score,
    predicted_category: category,
    features: { total_severity: totalSeverity, total_violations: totalViolations }
  });

  // Simulate SMS (will trigger actual SMS later)
  const smsResult = await simulateSMS(record, score, category);

  sendJSON(res, 200, {
    success: true,
    message: 'Violation approved, risk score updated, SMS queued',
    record_id,
    risk_score: score,
    risk_category: category,
    sms_queued: smsResult.success,
    warning_sent: category === 'High'
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

  sendJSON(res, 200, { success: true, message: 'Violation rejected' });
}

// POST /send-warning
// Manual trigger for high-risk warning
async function sendWarning(req, res) {
  const { vehicle_id } = await parseBody(req);
  if (!vehicle_id) return sendJSON(res, 400, { error: 'vehicle_id required' });

  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicle_id)
    .single();

  if (!vehicle) return sendJSON(res, 404, { error: 'Vehicle not found' });

  const msg = buildWarningMessage(vehicle);

  // Log SMS
  await supabase.from('sms_logs').insert({
    vehicle_id: vehicle.id,
    phone_number: vehicle.phone_number,
    message_type: 'warning',
    message_body: msg,
    status: 'simulated'
  });

  console.log(`\n[SMS SIMULATION] To: ${vehicle.phone_number}\n${msg}\n`);

  sendJSON(res, 200, { success: true, message: 'Warning SMS simulated', sms_body: msg });
}

// GET /violations?status=pending
async function getViolations(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const status = url.searchParams.get('status');

  let query = supabase
    .from('violation_details')
    .select('*');

  if (status) query = query.eq('status', status);

  const { data, error } = await query.order('detected_at', { ascending: false });

  if (error) return sendJSON(res, 500, { error: error.message });
  sendJSON(res, 200, { violations: data, count: data.length });
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

//sms part
function buildFineMessage(record, riskCategory) {
  return `[TrafficGuard] Dear ${record.vehicles.owner_name}, a traffic violation (${record.violations_master.violation_name}) has been recorded against your vehicle ${record.vehicles.plate_number}. Fine: Rs.${record.fine_amount}. Your current risk level: ${riskCategory}. Pay within 30 days to avoid legal action.`;
}

function buildWarningMessage(vehicle) {
  return `[TrafficGuard WARNING] Dear ${vehicle.owner_name}, your vehicle ${vehicle.plate_number} has been flagged as HIGH RISK (Score: ${vehicle.risk_score}). You have ${vehicle.total_violations} violation(s) on record. Further violations may result in license suspension.`;
}

async function simulateSMS(record, riskScore, riskCategory) {
  const msg = buildFineMessage(record, riskCategory);
  console.log(`\n[SMS SIMULATION — Fine Notice]\nTo: ${record.vehicles.phone_number}\n${msg}\n`);

  await supabase.from('sms_logs').insert({
    vehicle_id: record.vehicle_id,
    violation_record_id: record.id,
    phone_number: record.vehicles.phone_number,
    message_type: 'fine_notice',
    message_body: msg,
    status: 'simulated'
  });

  // Auto-send warning if high risk
  if (riskCategory === 'High') {
    const warning = buildWarningMessage({ ...record.vehicles, risk_score: riskScore, total_violations: record.vehicles.total_violations });
    console.log(`\n[SMS SIMULATION — High Risk Warning]\nTo: ${record.vehicles.phone_number}\n${warning}\n`);

    await supabase.from('sms_logs').insert({
      vehicle_id: record.vehicle_id,
      violation_record_id: record.id,
      phone_number: record.vehicles.phone_number,
      message_type: 'warning',
      message_body: warning,
      status: 'simulated'
    });
  }

  return { success: true };
}

//routes
const ROUTES = {
  'GET /health': healthCheck,
  'GET /violations': getViolations,
  'GET /risk-scores': getRiskScores,
  'POST /detect-plate': detectPlate,
  'POST /create-violation': createViolation,
  'POST /approve-violation': approveViolation,
  'POST /reject-violation': rejectViolation,
  'POST /send-warning': sendWarning,
};

const server = http.createServer(async (req, res) => {
  setCORSHeaders(res);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const urlPath = req.url.split('?')[0];
  const routeKey = `${req.method} ${urlPath}`;
  const handler = ROUTES[routeKey];

  if (!handler) {
    return sendJSON(res, 404, { error: `Route not found: ${routeKey}` });
  }

  try {
    await handler(req, res);
  } catch (err) {
    console.error('[ERROR]', err);
    sendJSON(res, 500, { error: 'Internal server error', detail: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n🛡  TrafficGuard API Server running on http://localhost:${PORT}`);
  console.log(`   Routes: ${Object.keys(ROUTES).join(' | ')}\n`);
});