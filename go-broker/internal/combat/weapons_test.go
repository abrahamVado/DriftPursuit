package combat

import "testing"

func TestResolveWeaponBehaviour(t *testing.T) {
	//1.- Resolve a shell weapon and ensure the archetype merges correctly.
	behaviour, err := ResolveWeaponBehaviour("pulse-cannon")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if behaviour.Archetype != WeaponArchetypeShell {
		t.Fatalf("expected shell archetype, got %v", behaviour.Archetype)
	}
	if behaviour.ProjectileSpeed <= 0 {
		t.Fatalf("expected projectile speed to be set")
	}
	if behaviour.Cooldown <= 0 {
		t.Fatalf("expected cooldown to be positive")
	}
}

func TestHandleMissileFireWithDecoy(t *testing.T) {
	//1.- Pull the missile behaviour so the test can assert decoy probabilities.
	behaviour, err := ResolveWeaponBehaviour("micro-missile")
	if err != nil {
		t.Fatalf("unexpected error resolving behaviour: %v", err)
	}
	if behaviour.DecoyBreakProbability <= 0 {
		t.Fatalf("expected missile to have decoy probability")
	}
	//2.- Fire the missile with an active decoy to exercise the spoof path.
	event, err := HandleWeaponFire(WeaponRequest{
		WeaponID:       "micro-missile",
		MatchSeed:      "match-seed",
		ProjectileID:   "missile-1",
		TargetID:       "target-1",
		DistanceMeters: 400,
		DecoyActive:    true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !event.DecoyTriggered {
		t.Fatalf("expected decoy to trigger for missile")
	}
	//3.- Determinism check ensures repeated calls share the same spoof outcome.
	repeat, err := HandleWeaponFire(WeaponRequest{
		WeaponID:       "micro-missile",
		MatchSeed:      "match-seed",
		ProjectileID:   "missile-1",
		TargetID:       "target-1",
		DistanceMeters: 400,
		DecoyActive:    true,
	})
	if err != nil {
		t.Fatalf("unexpected error on repeat: %v", err)
	}
	if event.MissileSpoofed != repeat.MissileSpoofed {
		t.Fatalf("expected deterministic spoof outcome")
	}
}

func TestHandleShellFire(t *testing.T) {
	//1.- Compute shell travel time to validate projectile handling.
	event, err := HandleWeaponFire(WeaponRequest{WeaponID: "pulse-cannon", DistanceMeters: 100})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if event.TravelTime <= 0 {
		t.Fatalf("expected positive travel time")
	}
}

func TestHandleLaserFire(t *testing.T) {
	//1.- Ensure lasers expose beam duration rather than projectile travel.
	event, err := HandleWeaponFire(WeaponRequest{WeaponID: "scatter-laser"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if event.BeamDuration <= 0 {
		t.Fatalf("expected beam duration for laser")
	}
}

func TestHandleDecoyActivation(t *testing.T) {
	//1.- Derive decoy activation values shared with the client HUD.
	decoy := HandleDecoyActivation()
	if decoy.Duration <= 0 {
		t.Fatalf("expected decoy duration")
	}
	if decoy.BreakProbability <= 0 {
		t.Fatalf("expected positive decoy probability")
	}
}

func TestTriggerBotWeaponCoversAllArchetypes(t *testing.T) {
	//1.- Iterate representative weapons to ensure bot triggers support every archetype.
	tests := []struct {
		weaponID string
	}{
		{weaponID: "pulse-cannon"},
		{weaponID: "micro-missile"},
		{weaponID: "scatter-laser"},
	}
	for _, tc := range tests {
		event, err := TriggerBotWeapon(WeaponRequest{WeaponID: tc.weaponID, DistanceMeters: 150, MatchSeed: "seed", ProjectileID: "proj", TargetID: "target"})
		if err != nil {
			t.Fatalf("unexpected error for %s: %v", tc.weaponID, err)
		}
		if event.Behaviour.ID != tc.weaponID {
			t.Fatalf("expected behaviour id %s, got %s", tc.weaponID, event.Behaviour.ID)
		}
	}
}

func TestTriggerBotDecoy(t *testing.T) {
	//1.- Ensure bot decoy triggers reflect the shared balance payload.
	decoy := TriggerBotDecoy()
	if decoy.Duration <= 0 {
		t.Fatalf("expected decoy duration")
	}
	if decoy.BreakProbability <= 0 {
		t.Fatalf("expected positive probability")
	}
}
