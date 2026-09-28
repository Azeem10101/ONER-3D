import { Journey } from "@/components/Journey";

/**
 * The scroll experience.
 *
 * This stays a Server Component on purpose: the 3D layer, the overlays, and
 * the scroll store are all client-side, but the page shell and its metadata
 * do not need to be. The cost of that boundary is one client reference.
 */
export default function Home() {
  return <Journey />;
}
