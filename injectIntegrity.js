const fs = require('fs');

let controller = fs.readFileSync('controllers/examController.js', 'utf8');

const targetStr = `    // ── 2. Server-Authoritative Anti-Cheat & Violation Merging ─────────
    const serverViolations = Array.isArray(exam.serverViolations) ? exam.serverViolations : [];
    const serverCount = Number(exam.serverViolationCount || serverViolations.length || 0);
    const clientCount = Number(violationCount || 0);
    const effectiveViolationCount = Math.max(serverCount, clientCount);
    const calculatedIntegrityScore = Math.max(0, 100 - (effectiveViolationCount * 25));`;

const newStr = `    // ── 2. Server-Authoritative Anti-Cheat & Violation Merging ─────────
    const serverViolations = Array.isArray(exam.serverViolations) ? exam.serverViolations : [];
    
    // Forensic Trust Score implementation (S_trust)
    const N_tab = Number(violationCount || 0); // Client tab switches / blur events
    const N_trap = exam.adaptiveMetrics?.trapResults?.fellForTrapCount || 0;
    const G_flag = exam.adaptiveMetrics?.guessDetected ? 1 : 0;
    const N_face = serverViolations.filter(v => v.type === 'face_violation' || v.type === 'FACE_VIOLATION').length;
    const delta_conf = 0; // Baseline drop confidence (if tracking visual confidence)

    const w1 = 2.0;
    const w2 = 25.0;
    const w3 = 10.0;
    const w4 = 15.0;
    const w5 = 15.0;

    const penalty = (w1 * Math.min(N_tab, 10)) 
                  + (w2 * N_trap) 
                  + (w3 * delta_conf) 
                  + (w4 * G_flag) 
                  + (w5 * N_face);

    const calculatedIntegrityScore = Math.max(0, 100 - penalty);
    const effectiveViolationCount = N_tab + N_face + (exam.serverViolationCount || 0);`;

controller = controller.replace(targetStr, newStr);

// Also need to handle face_violation tracking if the frontend calls `POST /api/exams/record-violation`
// Wait, the frontend sends `{ event: "telemetry_event", type: "face_violation", subtype: faceState, timestamp: Date.now() }`
// But the backend `recordProctorViolation` expects `type`, `reason`, `confidence`.
// If `type === "face_violation"`, we should allow it.

fs.writeFileSync('controllers/examController.js', controller);

console.log('Replaced integrity score calculation.');
