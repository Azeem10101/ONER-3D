"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { sampleCamera } from "@/scene/timeline";
import { scrollStore } from "@/lib/scrollStore";

/**
 * How far the camera lags behind the scroll position, per frame.
 *
 * 0 = rigidly locked to the scroll wheel (feels mechanical, and any jitter in
 * the scroll event shows up directly as camera shake). 1 = never arrives.
 * 0.12 lands at roughly a 120ms trail, which is enough to smooth out
 * trackpad and wheel quantisation without reading as "laggy".
 */
const LAG = 0.12;

const lookAt = new Vector3();

/**
 * Drives the camera along the timeline.
 *
 * This is the single point where scroll position becomes a camera transform.
 * It runs inside the R3F render loop, so it is frame-rate synchronised with
 * drawing and allocates nothing per frame.
 */
export function CameraRig() {
  const initialised = useRef(false);

  // The camera is read from the frame state rather than captured in render
  // scope. Mutating a value obtained from the render loop is how R3F expects
  // per-frame changes to be made, and it keeps the React Compiler's
  // immutability lint rule satisfied.
  useFrame((frame) => {
    const { camera } = frame;

    // Advance the shared damped progress. Only the render loop may do this.
    scrollStore.step(LAG);

    const state = sampleCamera(scrollStore.smoothed);

    camera.position.set(state.position[0], state.position[1], state.position[2]);

    lookAt.set(state.target[0], state.target[1], state.target[2]);
    camera.lookAt(lookAt);

    if (camera instanceof PerspectiveCamera) {
      if (!initialised.current) {
        camera.fov = state.fov;
        initialised.current = true;
      } else if (camera.fov !== state.fov) {
        // Guard the write: updateProjectionMatrix is not free, and the
        // timeline holds a constant fov through most shots.
        camera.fov = state.fov;
        camera.updateProjectionMatrix();
      }
    }
  });

  return null;
}
