(function (global) {
  if (typeof global.THREE === 'undefined') {
    console.error('GLTFLoader requires THREE to be available on the global scope.');
    return;
  }

  const THREE = global.THREE;

  const COMPONENT_TYPES = {
    5120: Int8Array,
    5121: Uint8Array,
    5122: Int16Array,
    5123: Uint16Array,
    5125: Uint32Array,
    5126: Float32Array,
  };

  const TYPE_SIZES = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT2: 4,
    MAT3: 9,
    MAT4: 16,
  };

  function decodeDataURI(uri) {
    const match = uri.match(/^data:(.*?)(;base64)?,(.*)$/);
    if (!match) {
      throw new Error('Only data URI buffer sources are supported by the bundled GLTFLoader.');
    }
    const isBase64 = !!match[2];
    const data = match[3];
    if (isBase64) {
      const binary = global.atob(data);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }
    const decoded = decodeURIComponent(data);
    const len = decoded.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = decoded.charCodeAt(i) & 0xff;
    }
    return bytes.buffer;
  }

  function resolveBufferViews(json) {
    const buffers = (json.buffers || []).map((bufferDef, index) => {
      if (typeof bufferDef.uri !== 'string') {
        throw new Error(`Buffer ${index} is missing an inline URI. Only embedded buffers are supported.`);
      }
      return decodeDataURI(bufferDef.uri);
    });

    return (json.bufferViews || []).map((viewDef) => {
      const buffer = buffers[viewDef.buffer];
      const byteOffset = viewDef.byteOffset || 0;
      const byteLength = viewDef.byteLength || 0;
      return buffer.slice(byteOffset, byteOffset + byteLength);
    });
  }

  function accessorToArray(accessorIndex, json, bufferViews) {
    const accessor = json.accessors?.[accessorIndex];
    if (!accessor) {
      throw new Error(`Missing accessor ${accessorIndex}.`);
    }
    const bufferViewIndex = accessor.bufferView;
    const bufferView = bufferViews[bufferViewIndex];
    if (!bufferView) {
      throw new Error(`Missing bufferView ${bufferViewIndex} for accessor ${accessorIndex}.`);
    }
    const ComponentArray = COMPONENT_TYPES[accessor.componentType];
    if (!ComponentArray) {
      throw new Error(`Unsupported accessor component type ${accessor.componentType}.`);
    }
    const itemSize = TYPE_SIZES[accessor.type];
    if (!itemSize) {
      throw new Error(`Unsupported accessor type ${accessor.type}.`);
    }
    const byteOffset = accessor.byteOffset || 0;
    const count = accessor.count || 0;
    const array = new ComponentArray(bufferView, byteOffset, count * itemSize);
    return { array, itemSize, count, normalized: !!accessor.normalized };
  }

  function createMaterial(materialIndex, json) {
    if (materialIndex == null) {
      return new THREE.MeshStandardMaterial({ color: 0xffffff });
    }
    const materialDef = json.materials?.[materialIndex] || {};
    const params = {};

    const pbr = materialDef.pbrMetallicRoughness || {};
    if (Array.isArray(pbr.baseColorFactor)) {
      const color = new THREE.Color().fromArray(pbr.baseColorFactor);
      params.color = color;
      const alpha = pbr.baseColorFactor.length > 3 ? pbr.baseColorFactor[3] : 1;
      if (alpha < 1) {
        params.transparent = true;
        params.opacity = alpha;
      }
    }
    if (typeof pbr.metallicFactor === 'number') {
      params.metalness = pbr.metallicFactor;
    }
    if (typeof pbr.roughnessFactor === 'number') {
      params.roughness = pbr.roughnessFactor;
    }

    const material = new THREE.MeshStandardMaterial(params);
    if (materialDef.doubleSided) {
      material.side = THREE.DoubleSide;
    }
    return material;
  }

  function applyNodeTransform(node, nodeDef) {
    if (Array.isArray(nodeDef.matrix) && nodeDef.matrix.length === 16) {
      node.applyMatrix4(new THREE.Matrix4().fromArray(nodeDef.matrix));
      return;
    }
    if (Array.isArray(nodeDef.translation)) {
      node.position.fromArray(nodeDef.translation);
    }
    if (Array.isArray(nodeDef.rotation)) {
      node.quaternion.fromArray(nodeDef.rotation);
    }
    if (Array.isArray(nodeDef.scale)) {
      node.scale.fromArray(nodeDef.scale);
    }
  }

  function instantiateMesh(meshIndex, json, bufferViews) {
    const meshDef = json.meshes?.[meshIndex];
    if (!meshDef) {
      throw new Error(`Missing mesh definition ${meshIndex}.`);
    }
    const group = new THREE.Group();
    group.name = meshDef.name || '';

    (meshDef.primitives || []).forEach((primitiveDef, primitiveIndex) => {
      const geometry = new THREE.BufferGeometry();
      const attributes = primitiveDef.attributes || {};
      const mode = primitiveDef.mode == null ? 4 : primitiveDef.mode;
      if (mode !== 4) {
        throw new Error(`Primitive ${primitiveIndex} of mesh ${meshIndex} uses unsupported draw mode ${mode}.`);
      }

      if (attributes.POSITION == null) {
        throw new Error(`Primitive ${primitiveIndex} of mesh ${meshIndex} is missing POSITION attribute.`);
      }
      const position = accessorToArray(attributes.POSITION, json, bufferViews);
      geometry.setAttribute('position', new THREE.BufferAttribute(position.array, position.itemSize, position.normalized));

      if (attributes.NORMAL != null) {
        const normal = accessorToArray(attributes.NORMAL, json, bufferViews);
        geometry.setAttribute('normal', new THREE.BufferAttribute(normal.array, normal.itemSize, normal.normalized));
      } else {
        geometry.computeVertexNormals();
      }

      if (primitiveDef.indices != null) {
        const index = accessorToArray(primitiveDef.indices, json, bufferViews);
        geometry.setIndex(new THREE.BufferAttribute(index.array, 1));
      }

      const material = createMaterial(primitiveDef.material, json);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = primitiveDef.name || '';
      group.add(mesh);
    });

    return group.children.length === 1 ? group.children[0] : group;
  }

  function buildNode(nodeIndex, json, bufferViews) {
    const nodeDef = json.nodes?.[nodeIndex];
    if (!nodeDef) {
      throw new Error(`Missing node definition ${nodeIndex}.`);
    }
    let object;
    if (nodeDef.mesh != null) {
      object = instantiateMesh(nodeDef.mesh, json, bufferViews);
    } else {
      object = new THREE.Object3D();
    }
    object.name = nodeDef.name || '';
    applyNodeTransform(object, nodeDef);

    (nodeDef.children || []).forEach((childIndex) => {
      const child = buildNode(childIndex, json, bufferViews);
      object.add(child);
    });
    return object;
  }

  class MinimalGLTFLoader {
    constructor(manager) {
      this.manager = manager || THREE.DefaultLoadingManager;
      this.path = '';
      this.resourcePath = '';
      this.withCredentials = false;
      this._fileLoader = new THREE.FileLoader(this.manager);
      this._fileLoader.setResponseType('text');
    }

    setPath(path) {
      this.path = path || '';
      return this;
    }

    setResourcePath(path) {
      this.resourcePath = path || '';
      return this;
    }

    setCrossOrigin() {
      // Cross-origin handling is delegated to FileLoader.
      return this;
    }

    setWithCredentials(value) {
      this.withCredentials = value;
      return this;
    }

    load(url, onLoad, onProgress, onError) {
      const resolvedUrl = this.path ? this.path + url : url;
      const loader = this._fileLoader;
      loader.setWithCredentials(this.withCredentials);

      this.manager.itemStart(resolvedUrl);

      loader.load(
        resolvedUrl,
        (text) => {
          let json;
          try {
            json = JSON.parse(text);
          } catch (parseErr) {
            this.manager.itemError(resolvedUrl);
            this.manager.itemEnd(resolvedUrl);
            if (onError) onError(parseErr);
            return;
          }
          this.parse(json, this.resourcePath || this.path)
            .then((result) => {
              this.manager.itemEnd(resolvedUrl);
              if (onLoad) onLoad(result);
            })
            .catch((err) => {
              this.manager.itemError(resolvedUrl);
              this.manager.itemEnd(resolvedUrl);
              if (onError) onError(err);
            });
        },
        onProgress,
        (err) => {
          this.manager.itemError(resolvedUrl);
          this.manager.itemEnd(resolvedUrl);
          if (onError) onError(err);
        }
      );
    }

    parse(json) {
      try {
        const bufferViews = resolveBufferViews(json);
        const sceneIndex = json.scene || 0;
        const sceneDef = json.scenes?.[sceneIndex];
        if (!sceneDef) {
          throw new Error('glTF file does not define a default scene.');
        }
        const scene = new THREE.Scene();
        scene.name = sceneDef.name || '';

        (sceneDef.nodes || []).forEach((nodeIndex) => {
          const node = buildNode(nodeIndex, json, bufferViews);
          scene.add(node);
        });

        const result = {
          scene,
          scenes: [scene],
          asset: json.asset || {},
          parser: { json },
          userData: {},
        };
        return Promise.resolve(result);
      } catch (err) {
        return Promise.reject(err);
      }
    }
  }

  global.THREE.GLTFLoader = MinimalGLTFLoader;
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
