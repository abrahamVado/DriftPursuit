# Terra Sandbox: Keyboard Vehicle Control Task

## Objective
Introduce keyboard-based locomotion controls for Terra sandbox vehicles while retaining mouse-driven turret aiming, ensuring each connected player controls their own assigned vehicle.

## Background
The Terra sandbox currently focuses on vehicle spawning, turret manipulation via mouse input, projectile combat, and optional terrain deformation. However, vehicles still lack dedicated keyboard control schemes, and per-player input routing for turret/vehicle ownership needs explicit coverage.

## Requirements
- **Keyboard locomotion**
  - Implement WASD (or arrow key) support for accelerating, braking, and steering cars.
  - Implement keyboard-based pitch/roll/yaw inputs for planes, leveraging sensible key bindings (e.g., WASD plus QE for yaw).
  - Maintain compatibility with existing physics/controllers (reuse or extend current input managers).

- **Mouse turret control**
  - Preserve mouse movement as the sole driver for turret orientation across both cars and planes.
  - Ensure the mouse look is decoupled from vehicle directional control when keyboard inputs are active.

- **Per-player ownership**
  - Guarantee that each connected user controls exactly one vehicle instance (car or plane) with exclusive access to its keyboard and mouse inputs.
  - When AI placeholder vehicles are present, reassign or despawn them as human players join so that input conflicts do not arise.

## Deliverables
- Updated input handling modules for Terra that satisfy the requirements above.
- Any new configuration or documentation explaining default key bindings and how to customize them.
- Automated or manual test notes demonstrating multi-player control hand-off and turret behaviour.

## Acceptance Criteria
- Driving a car with the keyboard responds smoothly to acceleration, braking, and steering keys while the mouse only moves the turret stick.
- Flying a plane with the keyboard supports pitch, roll, and yaw adjustments without affecting turret orientation, which remains mouse-driven.
- Multiple players can join simultaneously, each receiving control of their own vehicle without cross-input interference.
- Documentation clearly states the keyboard bindings and player ownership behaviour.
