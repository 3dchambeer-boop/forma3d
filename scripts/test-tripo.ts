// =====================================================================
// Quick test: verify Tripo API key works
// =====================================================================

const API_KEY = process.env.TRIPO_API_KEY;
const BASE = 'https://openapi.tripo3d.ai/v3';

async function main() {
  if (!API_KEY) {
    console.error('TRIPO_API_KEY not set');
    process.exit(1);
  }
  console.log('[test] key loaded:', API_KEY.slice(0, 8) + '...');

  // 1. Check account balance
  console.log('\n[test] checking account balance...');
  const balRes = await fetch(`${BASE}/account/balance`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const bal = await balRes.json();
  console.log('[test] balance response:', JSON.stringify(bal, null, 2));

  // 2. Create text-to-model task with simple prompt
  console.log('\n[test] creating text-to-model task...');
  const createRes = await fetch(`${BASE}/generation/text-to-model`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      prompt: 'a simple cube with rounded edges',
      model: 'v2.5-20250123', // balanced, cheaper
      texture: false,
      pbr: false,
      face_limit: 1000,
    }),
  });
  const created = await createRes.json();
  console.log('[test] create response:', JSON.stringify(created, null, 2));

  if (created.code !== 0 || !created.data?.task_id) {
    console.error('[test] failed to create task');
    process.exit(1);
  }

  const taskId = created.data.task_id;
  console.log(`[test] task_id: ${taskId}`);

  // 3. Poll until done (max 5 minutes)
  console.log('\n[test] polling task status (every 5s, max 5min)...');
  const startTime = Date.now();
  let pollCount = 0;
  while (Date.now() - startTime < 5 * 60 * 1000) {
    pollCount++;
    const pollRes = await fetch(`${BASE}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const poll = await pollRes.json();
    const status = poll.data?.status;
    const progress = poll.data?.progress;
    console.log(`[test] poll #${pollCount} status=${status} progress=${progress}% elapsed=${Math.round((Date.now() - startTime) / 1000)}s`);

    if (status === 'success') {
      console.log('\n[test] ✅ TASK COMPLETED');
      console.log('[test] output:', JSON.stringify(poll.data.output, null, 2));
      console.log('[test] credits consumed:', poll.data.credits_consumed);

      // 4. Download the GLB file
      if (poll.data.output?.model_url) {
        console.log('\n[test] downloading model...');
        const dlRes = await fetch(poll.data.output.model_url);
        const buf = Buffer.from(await dlRes.arrayBuffer());
        const outPath = '/home/z/my-project/public/models/tripo-test-cube.glb';
        const { writeFileSync } = await import('fs');
        writeFileSync(outPath, buf);
        console.log(`[test] ✅ saved ${buf.length} bytes to ${outPath}`);
      }
      break;
    }
    if (status === 'failed' || status === 'cancelled') {
      console.error('[test] ❌ task failed:', JSON.stringify(poll.data));
      process.exit(1);
    }
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('\n[test] done');
}

main().catch(e => {
  console.error('[test] fatal:', e);
  process.exit(1);
});
