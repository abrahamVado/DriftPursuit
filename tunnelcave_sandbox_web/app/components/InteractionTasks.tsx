'use client'

import React from 'react'

const TASKS: Array<{ id: string; title: string; description: string }> = [
  {
    id: 'map-overview',
    title: 'Capture the map overview',
    description:
      'Open the sandbox world, position the camera to show the full arena, and save a screenshot for your documentation.',
  },
  {
    id: 'vehicle-lineup',
    title: 'Document the available vehicles',
    description:
      'Cycle through the spawn menu, showcase each vehicle in the viewport, and grab a screenshot of the lineup.',
  },
  {
    id: 'control-overlay',
    title: 'Record the control overlay',
    description:
      'Toggle the HUD controls reference, verify the bindings respond to input, and capture a screenshot for players.',
  },
]

export default function InteractionTasks() {
  //1.- Present a static checklist that walks integrators through the interaction evidence they must gather.
  return (
    <section className="interaction-tasks" aria-labelledby="interaction-tasks-heading">
      <h2 id="interaction-tasks-heading">Interaction readiness checklist</h2>
      <p>
        Complete these tasks to prove the sandbox client can load the world, control vehicles, and surface the HUD
        controls for your team.
      </p>
      <ul>
        {TASKS.map((task) => (
          <li key={task.id}>
            <div className="task-header">
              <h3>{task.title}</h3>
              <span aria-label="Task status" className="task-status">
                Status: Pending
              </span>
            </div>
            <p>{task.description}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
