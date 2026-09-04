/**
 * The LogoScene ViewModel contract.
 *
 * This mirrors the ViewModel authored in the Rive file. It is the entire API
 * surface between an app and the 3D scene — nothing here talks to the Luau
 * scripts or the GPU renderer directly, it only sets numbers, booleans and
 * triggers on a bound ViewModel instance.
 *
 * Keep in sync with logo3d/LogoViewport in the Rive file.
 */

export type ControlKind = "number" | "boolean" | "trigger" | "readonly-number" | "readonly-string";

export type Control = {
  path: string;
  label: string;
  kind: ControlKind;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
};

export type ControlGroup = {
  title: string;
  blurb?: string;
  controls: Control[];
};

export const CONTROL_GROUPS: ControlGroup[] = [
  {
    title: "Animation",
    blurb: "Rigid node animation and skinning, driven from the glTF clips.",
    controls: [
      {
        path: "animationIndex",
        label: "Clip",
        kind: "number",
        min: 0,
        max: 20,
        step: 1,
        hint: "0 = rest pose, 1..N selects a clip",
      },
      { path: "animationPlaying", label: "Playing", kind: "boolean" },
      { path: "animationLoop", label: "Loop", kind: "boolean" },
      {
        path: "animationSpeed",
        label: "Speed",
        kind: "number",
        min: -3,
        max: 3,
        step: 0.1,
        hint: "negative plays backwards",
      },
      { path: "animationPlay", label: "Restart clip", kind: "trigger" },
      { path: "animationName", label: "Current clip", kind: "readonly-string" },
      { path: "animationCount", label: "Clip count", kind: "readonly-number" },
      { path: "animationDuration", label: "Duration (s)", kind: "readonly-number" },
      { path: "animationTime", label: "Time (s)", kind: "readonly-number" },
    ],
  },
  {
    title: "Spin",
    controls: [
      { path: "spinEnabled", label: "Spin", kind: "boolean" },
      { path: "spinSpeed", label: "Speed (deg/s)", kind: "number", min: -360, max: 360, step: 5 },
      {
        path: "spinAxis",
        label: "Axis",
        kind: "number",
        min: 0,
        max: 2,
        step: 1,
        hint: "0 = X, 1 = Y, 2 = Z",
      },
    ],
  },
  {
    title: "Transform",
    blurb: "Position is in model radii — the model is auto-fitted to radius 1.",
    controls: [
      { path: "modelScale", label: "Scale", kind: "number", min: 0.05, max: 5, step: 0.05 },
      { path: "positionX", label: "Position X", kind: "number", min: -3, max: 3, step: 0.05 },
      { path: "positionY", label: "Position Y", kind: "number", min: -3, max: 3, step: 0.05 },
      { path: "positionZ", label: "Position Z", kind: "number", min: -3, max: 3, step: 0.05 },
      { path: "rotationX", label: "Rotation X", kind: "number", min: -180, max: 180, step: 1 },
      { path: "rotationY", label: "Rotation Y", kind: "number", min: -180, max: 180, step: 1 },
      { path: "rotationZ", label: "Rotation Z", kind: "number", min: -180, max: 180, step: 1 },
      { path: "scaleX", label: "Scale X", kind: "number", min: -3, max: 3, step: 0.05 },
      { path: "scaleY", label: "Scale Y", kind: "number", min: -3, max: 3, step: 0.05 },
      { path: "scaleZ", label: "Scale Z", kind: "number", min: -3, max: 3, step: 0.05 },
    ],
  },
  {
    title: "Camera",
    blurb: "Bound values are the rest pose; dragging the canvas offsets from them.",
    controls: [
      { path: "cameraYaw", label: "Yaw", kind: "number", min: -180, max: 180, step: 1 },
      { path: "cameraPitch", label: "Pitch", kind: "number", min: -85, max: 85, step: 1 },
      { path: "cameraDistance", label: "Distance", kind: "number", min: 1.15, max: 14, step: 0.1 },
      { path: "cameraFOV", label: "FOV", kind: "number", min: 5, max: 120, step: 1 },
      { path: "cameraTargetX", label: "Target X", kind: "number", min: -3, max: 3, step: 0.05 },
      { path: "cameraTargetY", label: "Target Y", kind: "number", min: -3, max: 3, step: 0.05 },
      { path: "cameraTargetZ", label: "Target Z", kind: "number", min: -3, max: 3, step: 0.05 },
      { path: "orbitEnabled", label: "Orbit enabled", kind: "boolean" },
      { path: "orbitLockYaw", label: "Lock yaw", kind: "boolean" },
      { path: "orbitLockPitch", label: "Lock pitch", kind: "boolean" },
    ],
  },
  {
    title: "Material & light",
    blurb: "Metallic and roughness apply when textures are off.",
    controls: [
      { path: "showTextures", label: "Show textures", kind: "boolean" },
      { path: "metallic", label: "Metallic", kind: "number", min: 0, max: 1, step: 0.01 },
      { path: "roughness", label: "Roughness", kind: "number", min: 0.02, max: 1, step: 0.01 },
      { path: "lightIntensity", label: "Light", kind: "number", min: 0, max: 5, step: 0.05 },
    ],
  },
];
