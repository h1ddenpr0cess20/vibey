export function createGrab({ stage, THREE, mesh, at, onGrab, onDrag, onDrop, inset = 0.6 }) {
  const canvas = stage._renderer.domElement;
  const camera = stage._camera;

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const local = new THREE.Vector3();
  const before = new THREE.Vector3();

  let id = null;
  let last = 0;

  const aim = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };

  const contain = (p) => {
    before.copy(p);
    local.copy(p).applyMatrix4(camera.matrixWorldInverse);
    const half = Math.tan((camera.fov * Math.PI) / 360) * Math.max(0.001, -local.z);
    const lx = Math.max(0, half * camera.aspect - inset);
    const ly = Math.max(0, half - inset);
    local.x = Math.max(-lx, Math.min(lx, local.x));
    local.y = Math.max(-ly, Math.min(ly, local.y));
    p.copy(local).applyMatrix4(camera.matrixWorld);
    return p.distanceToSquared(before) > 1e-6;
  };

  stage.addEventListener('pointerdown', (e) => {
    if (id !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    aim(e);
    if (ray.intersectObject(mesh, false).length === 0) return;

    id = e.pointerId;
    stage._controls.enabled = false;
    e.stopPropagation();

    try { stage.setPointerCapture(id); } catch { }

    camera.getWorldDirection(forward);
    plane.setFromNormalAndCoplanarPoint(forward, at());
    offset.set(0, 0, 0);
    if (ray.ray.intersectPlane(plane, hit)) offset.copy(at()).sub(hit);

    last = e.timeStamp;
    onGrab?.();
  }, { capture: true });

  window.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    aim(e);
    if (!ray.ray.intersectPlane(plane, hit)) return;
    hit.add(offset);
    contain(hit);
    const dt = Math.min(0.1, Math.max(0.008, (e.timeStamp - last) / 1000));
    last = e.timeStamp;
    onDrag?.(hit, dt);
  }, { capture: true });

  const drop = (e) => {
    if (e.pointerId !== id) return;
    if (stage.hasPointerCapture?.(id)) stage.releasePointerCapture(id);
    id = null;
    stage._controls.enabled = true;
    onDrop?.();
  };
  window.addEventListener('pointerup', drop, { capture: true });
  window.addEventListener('pointercancel', drop, { capture: true });

  return {
    get held() {
      return id !== null;
    },
    contain,
  };
}
