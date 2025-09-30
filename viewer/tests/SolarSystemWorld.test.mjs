import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

test('solar system view toggles root visibility', async (t) => {
  const originalThree = globalThis.THREE;
  globalThis.THREE = THREE;
  t.after(() => {
    if (originalThree === undefined){
      delete globalThis.THREE;
    } else {
      globalThis.THREE = originalThree;
    }
  });

  const { SolarSystemWorld } = await import('../cloud-of-orbs/SolarSystemWorld.js');

  class StubShip {
    constructor(){
      this.hasLaunched = false;
      this.throttle = 0;
      this.speed = 0;
      this.state = {
        position: new THREE.Vector3(),
        orientation: new THREE.Quaternion(),
        velocity: new THREE.Vector3(),
        forward: new THREE.Vector3(0, 1, 0),
        up: new THREE.Vector3(0, 0, 1),
      };
      this.velocity = this.state.velocity;
    }

    dispose(){}
    setActive(){ }
    setVisible(){ }
    getState(){
      return this.state;
    }
    update(){
      return this.state;
    }
    getForwardVector(target = new THREE.Vector3()){
      return target.copy(this.state.forward);
    }
    getUpVector(target = new THREE.Vector3()){
      return target.copy(this.state.up);
    }
    getPosition(target = new THREE.Vector3()){
      return target.copy(this.state.position);
    }
    setPosition(position, { keepVelocity = false } = {}){
      this.state.position.copy(position);
      if (!keepVelocity){
        this.state.velocity.set(0, 0, 0);
      }
    }
    setOrientation(quaternion){
      this.state.orientation.copy(quaternion);
    }
    lookTowards(){ }
  }

  const scene = new THREE.Scene();
  const world = new SolarSystemWorld({
    scene,
    planetRegistry: new Map(),
    playerShipFactory: () => new StubShip(),
  });

  assert.equal(world.root.visible, true, 'root should be visible by default');

  world.exitSystemView();
  assert.equal(world.root.visible, false, 'root should be hidden after exiting system view');

  world.enterSystemView();
  assert.equal(world.root.visible, true, 'root should be visible after entering system view');
});
