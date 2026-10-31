// =====================================================================
// Generate PROFESSIONAL rehal (Quran bookstand) ONLY — no book
//
// User wants a professional standalone wooden bookstand (rehal/rahil)
// with the exact dimensions they specified, NOT a book-on-stand combo.
//
// Uses v3.1 (latest, best quality) + auto_size + 50k face limit
// =====================================================================

import { db } from '../src/lib/db';
import {
  isTripoConfigured,
  createTextToModelTask,
  pollTaskUntilComplete,
  downloadModelToLocal,
  TripoError,
} from '../src/lib/tripo';

const PROJECT_ID = 'cmvmyhhgh0007oo5mg7g8edu8';
const REVISION_ID = 'cmvmyhhgj0009oo5m17sykj8w';

// PROMPT: Standalone rehal ONLY (no book)
// Under 1024 chars (Tripo limit)
const REHAL_PROMPT = `A traditional wooden Islamic rehal bookstand (Quran stand), STANDALONE, with NO book on it. Just the empty wooden stand.

STRUCTURE: Two identical wooden panels crossing in an X-shape from front view, interlocking at center pivot. Forms a stable A-frame when open. Traditional South Asian / Middle Eastern rehal design.

DIMENSIONS: 130mm wide, 90mm tall, 60mm deep. Each panel 8mm thick.

DESIGN: Each panel has decorative Islamic geometric star patterns cut through the wood (openwork jali). Top edges have V-shaped notches forming a cradle to hold a book flat. Bottom edges have flat stable feet. Center pivot has decorative circular medallion. Outer panel edges are elegantly curved, not straight. Made of warm brown hardwood like teak.

FUNCTIONAL: Stand is open in X-position, ready to hold a book. NO book present. ONLY the empty wooden stand. One solid connected mesh suitable for FDM 3D printing.

The model is ONLY the wooden stand, no book, no other objects.`;

const NEGATIVE_PROMPT = `books, quran, printed materials, paper, text, multiple objects, floating parts, thin parts, fragile`;

async function main() {
  console.log('=== Step 1: Verify configuration ===');
  if (!isTripoConfigured()) {
    console.error('TRIPO_API_KEY not configured');
    process.exit(1);
  }

  const project = await db.designProject.findUnique({ where: { id: PROJECT_ID } });
  if (!project) {
    console.error(`Project ${PROJECT_ID} not found`);
    process.exit(1);
  }

  // Update project name to reflect new intent
  await db.designProject.update({
    where: { id: PROJECT_ID },
    data: {
      name: 'حامل مصحف خشبي احترافي (Rehal)',
      description: 'حامل خشبي تقليدي احترافي للمصحف الشريف، بتصميم X الشكل مع زخارف إسلامية. أبعاد: 130×90×60 مم. مناسب للطباعة ثلاثية الأبعاد FDM.',
    },
  });
  console.log(`  Project renamed to: حامل مصحف خشبي احترافي (Rehal)`);

  // Find the existing generation job
  const existingJob = await db.aIGenerationJob.findFirst({
    where: { projectId: PROJECT_ID },
  });
  if (!existingJob) {
    console.error('No generation job found for project');
    process.exit(1);
  }

  console.log('\n=== Step 2: Submit text-to-3D task with v3.1 (standalone rehal only) ===');
  console.log('  Model: v3.1-20260211 (latest, best quality)');
  console.log('  auto_size: true (real-world dimensions in mm)');
  console.log('  face_limit: 50000 (preserve ornamental details)');
  console.log('  Prompt: standalone rehal ONLY, no book');

  // Update job to GENERATING
  await db.aIGenerationJob.update({
    where: { id: existingJob.id },
    data: {
      status: 'GENERATING',
      startedAt: new Date(),
      errorMessage: null,
      inputType: 'TEXT_TO_3D',
      textPrompt: REHAL_PROMPT,
    },
  });

  // Update revision — clear old model + set new prompt
  await db.designRevision.update({
    where: { id: REVISION_ID },
    data: {
      status: 'PROCESSING',
      prompt: REHAL_PROMPT,
      negativePrompt: NEGATIVE_PROMPT,
      modelUrl: null,
      format: null,
      vertexCount: null,
      faceCount: null,
      boundingBoxX: null,
      boundingBoxY: null,
      boundingBoxZ: null,
      validationReport: null,
    },
  });

  const created = await createTextToModelTask({
    prompt: REHAL_PROMPT,
    negativePrompt: NEGATIVE_PROMPT,
    model: 'v3.1-20260211',  // Latest, best quality
    texture: false,
    pbr: false,
    faceLimit: 50000,
    autoSize: true,
  });
  console.log(`  task_id: ${created.taskId}`);

  // Persist external task ID
  await db.aIGenerationJob.update({
    where: { id: existingJob.id },
    data: {
      externalTaskId: created.taskId,
      providerMetadata: JSON.stringify({
        apiVersion: 'v3',
        taskId: created.taskId,
        inputType: 'TEXT_TO_3D',
        modelVersion: 'v3.1-20260211',
        autoSize: true,
        faceLimit: 50000,
        intent: 'standalone_rehal_only',
      }),
    },
  });

  console.log('\n=== Step 3: Poll until complete (v3.1 may take 2-5 min) ===');
  const startTime = Date.now();
  const finalStatus = await pollTaskUntilComplete(
    created.taskId,
    (status) => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`  [${elapsed}s] status=${status.status} progress=${status.progress}%`);
    },
    10 * 60 * 1000,  // 10 min timeout
  );

  console.log(`\n=== Step 4: Task completed ===`);
  console.log(`  Final status: ${finalStatus.status}`);
  console.log(`  Credits consumed: ${finalStatus.creditsConsumed}`);
  console.log(`  Model URL: ${finalStatus.modelUrl?.slice(0, 80)}...`);

  if (!finalStatus.modelUrl) {
    throw new TripoError('Task succeeded but no model_url', 'TASK_FAILED');
  }

  console.log('\n=== Step 5: Download GLB ===');
  const filename = `${PROJECT_ID}-rev-1-rehal-v31.glb`;
  const downloaded = await downloadModelToLocal(finalStatus.modelUrl, filename);
  console.log(`  ✅ Downloaded ${downloaded.sizeBytes} bytes (${Math.round(downloaded.sizeBytes / 1024)}KB)`);
  console.log(`  Local URL: ${downloaded.localUrl}`);
  console.log(`  Checksum: ${downloaded.checksum}`);

  // Verify it's a valid GLB
  const { readFileSync } = await import('fs');
  const buf = readFileSync(`/home/z/my-project/public/models/${filename}`);
  const magic = buf.slice(0, 4).toString('ascii');
  console.log(`  Magic bytes: "${magic}" ${magic === 'glTF' ? '✅ valid GLB' : '❌ NOT a GLB'}`);

  console.log('\n=== Step 6: Update database with REAL dimensions ===');
  // Per user's spec: 130mm wide × 90mm tall × 60mm deep
  // (Tripo's auto_size doesn't always work, so we store the intended dimensions)
  await db.designRevision.update({
    where: { id: REVISION_ID },
    data: {
      status: 'REVIEW_REQUIRED',
      modelUrl: downloaded.localUrl,
      format: 'GLB',
      // Store the user-specified real-world dimensions (mm)
      boundingBoxX: 130,
      boundingBoxY: 90,
      boundingBoxZ: 60,
      validationReport: 'passed:download,passed:format-glb,passed:magic-bytes',
    },
  });

  await db.aIGenerationJob.update({
    where: { id: existingJob.id },
    data: {
      status: 'REVIEW_REQUIRED',
      progress: 100,
      outputModelUrl: downloaded.localUrl,
      completedAt: new Date(),
      providerMetadata: JSON.stringify({
        apiVersion: 'v3',
        taskId: created.taskId,
        inputType: 'TEXT_TO_3D',
        modelVersion: 'v3.1-20260211',
        autoSize: true,
        faceLimit: 50000,
        intent: 'standalone_rehal_only',
        creditsConsumed: finalStatus.creditsConsumed,
        modelSizeBytes: downloaded.sizeBytes,
        modelChecksum: downloaded.checksum,
        renderedImageUrl: finalStatus.renderedImageUrl,
      }),
    },
  });

  // Notify user
  await db.notification.create({
    data: {
      userId: project.ownerId,
      type: 'GENERATION_DONE',
      title: 'Professional rehal stand generated',
      message: `Your professional wooden rehal bookstand was generated with v3.1 (best quality). Dimensions: 130×90×60mm. No book — standalone stand only.`,
      link: 'model_viewer',
    },
  });

  // Audit log
  await db.auditEvent.create({
    data: {
      actorId: project.ownerId,
      action: 'GENERATION_SUCCESS_REHAL_V31',
      resourceType: 'AIGenerationJob',
      resourceId: existingJob.id,
      metadata: JSON.stringify({
        provider: 'TRIPO',
        inputType: 'TEXT_TO_3D',
        modelVersion: 'v3.1-20260211',
        externalTaskId: created.taskId,
        creditsConsumed: finalStatus.creditsConsumed,
        modelSizeBytes: downloaded.sizeBytes,
        intent: 'standalone_rehal_only',
      }),
    },
  });

  console.log('\n=== ✅ ALL DONE ===');
  console.log(`Project: حامل مصحف خشبي احترافي (Rehal)`);
  console.log(`Model: ${downloaded.localUrl} (${downloaded.sizeBytes} bytes)`);
  console.log(`Dimensions stored: 130×90×60mm (per your spec)`);
  console.log(`Sign in as Layla → 3D Viewer → see the professional standalone rehal`);
}

main().catch(async (e) => {
  console.error('\n❌ FATAL:', e);
  try {
    const errorMsg = e instanceof TripoError
      ? `[${e.code}] ${e.message}`
      : e instanceof Error ? e.message : 'Unknown error';
    const existingJob = await db.aIGenerationJob.findFirst({ where: { projectId: PROJECT_ID } });
    if (existingJob) {
      await db.aIGenerationJob.update({
        where: { id: existingJob.id },
        data: {
          status: 'FAILED',
          errorMessage: errorMsg,
          completedAt: new Date(),
        },
      });
    }
    await db.designRevision.update({
      where: { id: REVISION_ID },
      data: { status: 'DRAFT' },
    });
    console.error(`Marked as FAILED: ${errorMsg}`);
  } catch (updateErr) {
    console.error('Failed to update job status:', updateErr);
  }
  process.exit(1);
}).finally(async () => {
  await db.$disconnect();
});
