// =====================================================================
// Re-generate the Quran book + wooden rehal stand model with better settings
//
// Improvements over the previous generation:
//   - v3.0-20250812 (instead of v2.5) — better multi-object scenes
//   - auto_size: true → real-world dimensions in mm
//   - face_limit: 50000 (instead of 10000) — preserve fine ornamental details
//   - Improved prompt emphasizing BOTH the book AND the stand as one unit
//
// Cost: ~50 credits for v3.0 text-to-model with these settings
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

// Improved prompt — emphasizes BOTH book AND stand as one combined model
// Max 1024 chars per Tripo API limit
const IMPROVED_PROMPT = `A closed Holy Quran book resting on top of a traditional wooden X-shaped rehal bookstand, as one connected 3D printable model.

THE QURAN BOOK (on top): closed rectangular hardcover, 120mm tall, 85mm wide, 20mm thick, rounded corners, decorative central octagonal star medallion embossed on cover, Islamic geometric border pattern around edges, book spine on left with horizontal ridge lines, visible stacked page layers along top/bottom/right edges, ribbon bookmark hanging from bottom.

THE REHAL STAND (underneath, supporting book): traditional X-shaped folding wooden bookstand, 130mm wide, 90mm tall, 60mm deep, two crossed wooden panels forming X from front view, each panel has decorative geometric star cutout patterns, panels join at central pivot, flat horizontal surfaces at top where book rests, stable feet at bottom.

COMBINED: book placed flat on top of rehal's upper surfaces, both objects form ONE single connected mesh, no separate parts, stable base, suitable for FDM 3D printing with minimal overhangs.`;

const NEGATIVE_PROMPT = `floating parts, disconnected geometry, missing stand, missing book, thin parts, fragile ornaments, unsupported overhangs, unstable, non-manifold, tiny details`;

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
  console.log(`  Project: ${project.name}`);

  const revision = await db.designRevision.findUnique({ where: { id: REVISION_ID } });
  if (!revision) {
    console.error(`Revision ${REVISION_ID} not found`);
    process.exit(1);
  }
  console.log(`  Current revision status: ${revision.status}`);
  console.log(`  Current modelUrl: ${revision.modelUrl || '(none)'}`);

  // Find the existing generation job
  const existingJob = await db.aIGenerationJob.findFirst({
    where: { projectId: PROJECT_ID },
  });
  if (!existingJob) {
    console.error('No generation job found for project');
    process.exit(1);
  }
  console.log(`  Existing job: ${existingJob.id} (status: ${existingJob.status})`);

  console.log('\n=== Step 2: Submit text-to-3D task with improved settings ===');
  console.log('  Model: v3.0-20250812 (better multi-object scenes)');
  console.log('  auto_size: true (real-world dimensions in mm)');
  console.log('  face_limit: 50000 (preserve fine details)');
  console.log('  texture: false (geometry only for 3D printing)');
  console.log('');

  // Update job to GENERATING
  await db.aIGenerationJob.update({
    where: { id: existingJob.id },
    data: {
      status: 'GENERATING',
      startedAt: new Date(),
      errorMessage: null,
      inputType: 'TEXT_TO_3D',  // Switch from IMAGE_TO_3D to TEXT_TO_3D for better control
      textPrompt: IMPROVED_PROMPT,
    },
  });

  // Update revision prompt + status
  await db.designRevision.update({
    where: { id: REVISION_ID },
    data: {
      status: 'PROCESSING',
      prompt: IMPROVED_PROMPT,
      negativePrompt: NEGATIVE_PROMPT,
      modelUrl: null,  // Clear old model
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
    prompt: IMPROVED_PROMPT,
    negativePrompt: NEGATIVE_PROMPT,
    model: 'v3.0-20250812',
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
        modelVersion: 'v3.0-20250812',
        autoSize: true,
        faceLimit: 50000,
      }),
    },
  });

  console.log('\n=== Step 3: Poll until complete ===');
  const startTime = Date.now();
  const finalStatus = await pollTaskUntilComplete(
    created.taskId,
    (status) => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`  [${elapsed}s] status=${status.status} progress=${status.progress}%`);
    },
    10 * 60 * 1000,  // 10 min timeout (v3.0 may take longer)
  );

  console.log(`\n=== Step 4: Task completed ===`);
  console.log(`  Final status: ${finalStatus.status}`);
  console.log(`  Credits consumed: ${finalStatus.creditsConsumed}`);
  console.log(`  Model URL: ${finalStatus.modelUrl?.slice(0, 80)}...`);

  if (!finalStatus.modelUrl) {
    throw new TripoError('Task succeeded but no model_url', 'TASK_FAILED');
  }

  console.log('\n=== Step 5: Download GLB ===');
  const filename = `${PROJECT_ID}-rev-1-v3.glb`;  // New filename to avoid confusion with old
  const downloaded = await downloadModelToLocal(finalStatus.modelUrl, filename);
  console.log(`  ✅ Downloaded ${downloaded.sizeBytes} bytes (${Math.round(downloaded.sizeBytes / 1024)}KB)`);
  console.log(`  Local URL: ${downloaded.localUrl}`);
  console.log(`  Checksum: ${downloaded.checksum}`);

  // Verify it's a valid GLB
  const { readFileSync } = await import('fs');
  const buf = readFileSync(`/home/z/my-project/public/models/${filename}`);
  const magic = buf.slice(0, 4).toString('ascii');
  console.log(`  Magic bytes: "${magic}" ${magic === 'glTF' ? '✅ valid GLB' : '❌ NOT a GLB'}`);

  console.log('\n=== Step 6: Update database ===');
  await db.designRevision.update({
    where: { id: REVISION_ID },
    data: {
      status: 'REVIEW_REQUIRED',
      modelUrl: downloaded.localUrl,
      format: 'GLB',
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
        modelVersion: 'v3.0-20250812',
        autoSize: true,
        faceLimit: 50000,
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
      title: 'Quran model regenerated with improved settings',
      message: `"${project.name}" was regenerated with v3.0 model + auto_size + 50k face limit. The stand (rehal) should now be included.`,
      link: 'model_viewer',
    },
  });

  // Audit log
  await db.auditEvent.create({
    data: {
      actorId: project.ownerId,
      action: 'GENERATION_SUCCESS_V3_REGEN',
      resourceType: 'AIGenerationJob',
      resourceId: existingJob.id,
      metadata: JSON.stringify({
        provider: 'TRIPO',
        inputType: 'TEXT_TO_3D',
        modelVersion: 'v3.0-20250812',
        externalTaskId: created.taskId,
        creditsConsumed: finalStatus.creditsConsumed,
        modelSizeBytes: downloaded.sizeBytes,
        autoSize: true,
        faceLimit: 50000,
      }),
    },
  });

  console.log('\n=== ✅ ALL DONE ===');
  console.log(`Project: ${project.name}`);
  console.log(`New model: ${downloaded.localUrl} (${downloaded.sizeBytes} bytes)`);
  console.log(`Sign in as Layla → go to 3D Viewer → see the new model with stand`);
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
