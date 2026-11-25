import {
  FaceLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

let visionPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;

function getVision() {
  if (!visionPromise) {
    visionPromise = FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
    );
  }
  return visionPromise;
}

// Each camera gets its own VIDEO-mode instance. The WASM resolver is shared.
export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  const vision = await getVision();
  const modelAssetPath =
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
  const commonOptions = {
    runningMode: "VIDEO" as const,
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
  };
  try {
    return await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: "GPU" },
      ...commonOptions,
    });
  } catch (gpuError) {
    console.warn("MediaPipe GPU initialization failed; retrying on CPU.", gpuError);
    return FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: "CPU" },
      ...commonOptions,
    });
  }
}
