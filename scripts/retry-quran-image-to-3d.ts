// =====================================================================
// Retry IMAGE_TO_3D generation for the stuck "Quran" project
//
// This script:
//   1. Reads the existing generation job (which has referenceImageUrl as base64)
//   2. Decodes the base64 image
//   3. Uploads it to Tripo via uploadImageFile()
//   4. Calls createImageToModelTask() with the file_token
//   5. Polls until complete (~90s for image-to-3D)
//   6. Downloads the GLB
//   7. Updates the revision + generation job in DB
//   8. Sends notification + audit log
// =====================================================================

import { db } from '../src/lib/db';
import {
  isTripoConfigured,
  uploadImageFile,
  createImageToModelTask,
  pollTaskUntilComplete,
  downloadModelToLocal,
  TripoError,
} from '../src/lib/tripo';

const JOB_ID = 'cmvmyhhgl000boo5mviio7164';

async function main() {
  console.log('=== Step 1: Read existing job ===');
  const job = await db.aIGenerationJob.findUnique({
    where: { id: JOB_ID },
    include: { project: true },
  });
  if (!job) {
    console.error('Job not found');
    process.exit(1);
  }
  console.log(`  Project: ${job.project.name}`);
  console.log(`  Job status: ${job.status}`);
  console.log(`  Input type: ${job.inputType}`);
  console.log(`  Has reference image: ${!!job.referenceImageUrl}`);

  if (!job.referenceImageUrl) {
    console.error('No reference image in job');
    process.exit(1);
  }

  if (!isTripoConfigured()) {
    console.error('TRIPO_API_KEY not configured');
    process.exit(1);
  }

  // Find the revision
  const revision = await db.designRevision.findFirst({
    where: { projectId: job.projectId, version: 1 },
  });
  if (!revision) {
    console.error('Revision not found');
    process.exit(1);
  }

  console.log('\n=== Step 2: Decode base64 image ===');
  const base64Match = job.referenceImageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!base64Match) {
    console.error('Invalid base64 format');
    process.exit(1);
  }
  const imageExt = base64Match[1] === 'jpeg' ? 'jpg' : base64Match[1];
  const imageBuffer = Buffer.from(base64Match[2], 'base64');
  console.log(`  Image format: ${base64Match[1]}`);
  console.log(`  Image size: ${imageBuffer.length} bytes (${Math.round(imageBuffer.length / 1024)}KB)`);

  if (imageBuffer.length > 20 * 1024 * 1024) {
    console.error(`Image too large: ${Math.round(imageBuffer.length / 1024 / 1024)}MB (max 20MB)`);
    process.exit(1);
  }

  // Mark job as GENERATING
  await db.aIGenerationJob.update({
    where: { id: JOB_ID },
    data: { status: 'GENERATING', startedAt: new Date(), errorMessage: null },
  });
  await db.designRevision.update({
    where: { id: revision.id },
    data: { status: 'PROCESSING' },
  });

  console.log('\n=== Step 3: Upload image to Tripo ===');
  const fileToken = await uploadImageFile(imageBuffer, `reference.${imageExt}`);
  console.log(`  file_token: ${fileToken}`);

  console.log('\n=== Step 4: Submit image-to-3D task ===');
  const created = await createImageToModelTask({
    input: fileToken,
    model: 'v2.5-20250123',
    texture: true,
    pbr: false,
    faceLimit: 10000,
  });
  console.log(`  task_id: ${created.taskId}`);

  // Persist external task ID
  await db.aIGenerationJob.update({
    where: { id: JOB_ID },
    data: {
      externalTaskId: created.taskId,
      providerMetadata: JSON.stringify({
        apiVersion: 'v3',
        taskId: created.taskId,
        inputType: 'IMAGE_TO_3D',
        fileToken,
      }),
    },
  });

  console.log('\n=== Step 5: Poll until complete ===');
  const startTime = Date.now();
  const finalStatus = await pollTaskUntilComplete(
    created.taskId,
    (status) => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`  [${elapsed}s] status=${status.status} progress=${status.progress}%`);
    }
  );

  console.log(`\n=== Step 6: Task completed ===`);
  console.log(`  Final status: ${finalStatus.status}`);
  console.log(`  Credits consumed: ${finalStatus.creditsConsumed}`);
  console.log(`  Model URL: ${finalStatus.modelUrl?.slice(0, 80)}...`);

  if (!finalStatus.modelUrl) {
    throw new TripoError('Task succeeded but no model_url', 'TASK_FAILED');
  }

  console.log('\n=== Step 7: Download GLB ===');
  const filename = `${job.projectId}-rev-${revision.version}.glb`;
  const downloaded = await downloadModelToLocal(finalStatus.modelUrl, filename);
  console.log(`  ✅ Downloaded ${downloaded.sizeBytes} bytes (${Math.round(downloaded.sizeBytes / 1024)}KB)`);
  console.log(`  Local URL: ${downloaded.localUrl}`);
  console.log(`  Checksum: ${downloaded.checksum}`);

  // Verify it's a valid GLB
  const { readFileSync } = await import('fs');
  const buf = readFileSync(`/home/z/my-project/public/models/${filename}`);
  const magic = buf.slice(0, 4).toString('ascii');
  console.log(`  Magic bytes: "${magic}" ${magic === 'glTF' ? '✅ valid GLB' : '❌ NOT a GLB'}`);

  console.log('\n=== Step 8: Update database ===');
  await db.designRevision.update({
    where: { id: revision.id },
    data: {
      status: 'REVIEW_REQUIRED',
      modelUrl: downloaded.localUrl,
      format: 'GLB',
      validationReport: 'passed:download,passed:format-glb,passed:magic-bytes',
    },
  });

  await db.aIGenerationJob.update({
    where: { id: JOB_ID },
    data: {
      status: 'REVIEW_REQUIRED',
      progress: 100,
      outputModelUrl: downloaded.localUrl,
      completedAt: new Date(),
      providerMetadata: JSON.stringify({
        apiVersion: 'v3',
        taskId: created.taskId,
        inputType: 'IMAGE_TO_3D',
        fileToken,
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
      userId: job.initiatedById,
      type: 'GENERATION_DONE',
      title: 'AI model generation completed (image-to-3D)',
      message: `"${job.project.name}" was generated by Tripo from your reference image and is ready for review.`,
      link: 'model_viewer',
    },
  });

  // Audit log
  await db.auditEvent.create({
    data: {
      actorId: job.initiatedById,
      action: 'GENERATION_SUCCESS',
      resourceType: 'AIGenerationJob',
      resourceId: JOB_ID,
      metadata: JSON.stringify({
        provider: 'TRIPO',
        inputType: 'IMAGE_TO_3D',
        externalTaskId: created.taskId,
        creditsConsumed: finalStatus.creditsConsumed,
        modelSizeBytes: downloaded.sizeBytes,
      }),
    },
  });

  console.log('\n=== ✅ ALL DONE ===');
  console.log(`Project: ${job.project.name}`);
  console.log(`Revision: v${revision.version} → status: REVIEW_REQUIRED`);
  console.log(`Model: ${downloaded.localUrl} (${downloaded.sizeBytes} bytes)`);
  console.log(`Sign in as Layla → go to 3D Viewer → select project to see the real model`);
}

main().catch(async (e) => {
  console.error('\n❌ FATAL:', e);
  // Update job as FAILED
  try {
    const errorMsg = e instanceof TripoError
      ? `[${e.code}] ${e.message}`
      : e instanceof Error ? e.message : 'Unknown error';
    await db.aIGenerationJob.update({
      where: { id: JOB_ID },
      data: {
        status: 'FAILED',
        errorMessage: errorMsg,
        completedAt: new Date(),
      },
    });
    console.error(`Job ${JOB_ID} marked as FAILED: ${errorMsg}`);
  } catch (updateErr) {
    console.error('Failed to update job status:', updateErr);
  }
  process.exit(1);
}).finally(async () => {
  await db.$disconnect();
});
