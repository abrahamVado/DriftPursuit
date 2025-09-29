# Invert Pitch/Roll Toggle – Manual QA Checklist

Use this checklist to confirm the new pitch/roll inversion toggle works in the
web viewer and that the default control behaviour is unchanged when the toggle
is off.

1. Open `viewer/index.html` in a browser served from the repository (for
   example, `python -m http.server` from the `viewer/` directory). Wait for the
   HUD to load.
2. Observe the Pilot Console buttons. The **Invert Pitch/Roll** button should
   show "Off" and the HUD should list "Pitch/Roll controls: standard".
3. Engage manual control (press **Enable Manual Control** or hit `M`) and use
   the arrow keys:
   - With the inversion toggle **Off**, `ArrowUp` pitches the aircraft up and
     `ArrowDown` pitches down as before.
   - `ArrowLeft` and `ArrowRight` continue to roll left and right respectively.
4. Click **Invert Pitch/Roll**. The button should highlight, its label should
   change to "On", and the HUD/control instructions should note that inversion
   is active.
5. With inversion enabled, hold manual control and test the arrow keys again:
   - `ArrowUp` now pitches the aircraft down while `ArrowDown` pitches up.
   - `ArrowLeft` rolls the aircraft to the right and `ArrowRight` rolls left.
6. Reload the page. Confirm the **Invert Pitch/Roll** button and HUD remember
   the previously selected state (On remains On, Off remains Off) thanks to
   persisted preferences.
7. Toggle inversion Off and confirm the button, HUD text, and control
   instructions revert to the standard orientation description.

If any step fails, capture console errors and report the regression.
