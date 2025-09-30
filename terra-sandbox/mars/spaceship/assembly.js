import THREE from '../../shared/threeProxy.js';

const TMP_VEC3 = new THREE.Vector3();
const TMP_QUAT = new THREE.Quaternion();
const TMP_EULER = new THREE.Euler();

function toQuaternion(rotation){
  if (!rotation) return new THREE.Quaternion();
  if (rotation.isQuaternion) return rotation.clone();
  if (rotation.isEuler){
    return new THREE.Quaternion().setFromEuler(rotation);
  }
  if (Array.isArray(rotation)){
    TMP_EULER.set(rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, 'XYZ');
    return new THREE.Quaternion().setFromEuler(TMP_EULER);
  }
  return new THREE.Quaternion();
}

function toVector3(position){
  if (!position) return new THREE.Vector3();
  if (position.isVector3) return position.clone();
  if (Array.isArray(position)){
    return new THREE.Vector3(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);
  }
  if (typeof position === 'object'){
    return new THREE.Vector3(position.x ?? 0, position.y ?? 0, position.z ?? 0);
  }
  return new THREE.Vector3();
}

function normaliseTags(tags){
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map(String);
  if (tags instanceof Set) return Array.from(tags).map(String);
  return [String(tags)];
}

export function createHardpoint({
  name,
  kind,
  size = 1,
  tags = [],
  position,
  rotation,
}) {
  if (!name) throw new Error('Hardpoint requires a name');
  if (!kind) throw new Error(`Hardpoint "${name}" requires a kind`);

  const anchor = new THREE.Object3D();
  anchor.name = `${name}Hardpoint`;
  anchor.position.copy(toVector3(position));
  anchor.quaternion.copy(toQuaternion(rotation));

  const descriptor = {
    name,
    kind,
    size,
    tags: new Set(normaliseTags(tags)),
    node: anchor,
  };

  return descriptor;
}

export function createPlugDescriptor({
  name = 'mount',
  kind,
  size = 1,
  tags = [],
  node,
  position,
  rotation,
}) {
  if (!kind) throw new Error(`Plug "${name}" requires a kind`);

  const anchor = node ?? new THREE.Object3D();
  anchor.name = `${name}Plug`;
  if (position) anchor.position.copy(toVector3(position));
  if (rotation) anchor.quaternion.copy(toQuaternion(rotation));

  return {
    name,
    kind,
    size,
    tags: new Set(normaliseTags(tags)),
    node: anchor,
  };
}

export function registerHardpoints(object, hardpoints = []) {
  const list = Array.isArray(hardpoints) ? hardpoints : [];
  if (!object.userData) object.userData = {};
  object.userData.hardpoints = list;
  const map = new Map();
  list.forEach((hp) => {
    if (hp?.node) object.add(hp.node);
    if (hp?.name) map.set(hp.name, hp);
  });
  object.userData.hardpointsMap = map;
  return object;
}

export function getHardpoint(object, name) {
  return object?.userData?.hardpointsMap?.get(name)
    ?? (object?.userData?.hardpoints ?? []).find((hp) => hp?.name === name)
    ?? null;
}

export function getPlug(part, name) {
  const plugs = part?.userData?.plugs;
  if (!Array.isArray(plugs)) return null;
  return plugs.find((plug) => plug?.name === name) ?? null;
}

export function isPlugCompatible(socket, plug) {
  if (!socket || !plug) return false;
  if (socket.kind !== plug.kind) return false;
  if (plug.size > socket.size) return false;
  if (socket.tags && socket.tags.size > 0) {
    for (const tag of socket.tags) {
      if (!plug.tags?.has?.(tag)) return false;
    }
  }
  return true;
}

export function snapPartToSocket(part, plug, socket) {
  if (!part || !plug || !socket) throw new Error('snapPartToSocket requires part, plug, and socket');
  const plugNode = plug.node;
  const socketNode = socket.node;
  if (!plugNode) throw new Error(`Plug "${plug.name}" is missing an anchor node`);
  if (!socketNode) throw new Error(`Socket "${socket.name}" is missing an anchor node`);

  part.updateMatrixWorld(true);
  plugNode.updateMatrixWorld(true);
  socketNode.updateMatrixWorld(true);

  const socketPosition = socketNode.getWorldPosition(TMP_VEC3);
  const socketQuaternion = socketNode.getWorldQuaternion(TMP_QUAT);

  const plugLocalPosition = plugNode.position.clone();
  const plugLocalQuaternion = plugNode.quaternion.clone();

  const plugQuaternionInverse = plugLocalQuaternion.clone().invert();
  const partQuaternion = socketQuaternion.clone().multiply(plugQuaternionInverse);

  part.quaternion.copy(partQuaternion);

  const offset = plugLocalPosition.applyQuaternion(partQuaternion);
  const partPosition = socketPosition.clone().sub(offset);
  part.position.copy(partPosition);
  part.updateMatrixWorld(true);
}

export function validateAssembly(root, { attachments = [], tolerance = 0.02 } = {}) {
  const issues = [];
  if (!root) {
    return { valid: false, issues: ['Missing root object'] };
  }

  root.updateMatrixWorld(true);

  // Check for duplicate socket occupancy
  const socketUsage = new Map();
  for (const attachment of attachments) {
    const socketName = attachment?.socket?.name;
    if (!socketName) continue;
    if (socketUsage.has(socketName)) {
      issues.push(`Socket "${socketName}" used multiple times`);
    } else {
      socketUsage.set(socketName, attachment);
    }
  }

  // Bounding sphere collision detection (ignoring the root hull itself)
  const parts = attachments
    .map((attachment) => attachment?.part)
    .filter((part) => part && part !== root && Number.isFinite(part.userData?.boundingRadius));

  for (let i = 0; i < parts.length; i += 1) {
    const partA = parts[i];
    const radiusA = partA.userData.boundingRadius ?? 0;
    const centerA = (partA.userData.boundingCenter ?? new THREE.Vector3()).clone();
    partA.localToWorld(centerA);

    for (let j = i + 1; j < parts.length; j += 1) {
      const partB = parts[j];
      const radiusB = partB.userData.boundingRadius ?? 0;
      const centerB = (partB.userData.boundingCenter ?? new THREE.Vector3()).clone();
      partB.localToWorld(centerB);

      const distance = centerA.distanceTo(centerB);
      const combined = radiusA + radiusB - tolerance;
      if (distance < combined) {
        issues.push(`Collision detected between "${partA.name ?? 'part'}" and "${partB.name ?? 'part'}"`);
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

export function attachPart(root, socketName, part, { plugName = 'mount' } = {}) {
  const socket = getHardpoint(root, socketName);
  if (!socket) throw new Error(`Hardpoint "${socketName}" not found`);
  const plug = getPlug(part, plugName);
  if (!plug) throw new Error(`Plug "${plugName}" not found on part "${part.name ?? 'anonymous'}"`);
  if (!isPlugCompatible(socket, plug)) {
    throw new Error(`Plug "${plug.name}" incompatible with socket "${socket.name}"`);
  }
  snapPartToSocket(part, plug, socket);
  root.add(part);
  return { socket, plug, part };
}

export default {
  createHardpoint,
  createPlugDescriptor,
  registerHardpoints,
  getHardpoint,
  getPlug,
  isPlugCompatible,
  snapPartToSocket,
  validateAssembly,
  attachPart,
};
