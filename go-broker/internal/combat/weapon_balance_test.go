package combat

import "testing"

func TestWeaponBalanceLoads(t *testing.T) {
	//1.- Load the catalog and ensure both archetypes and weapons are populated.
	catalog := WeaponBalance()
	if len(catalog.Archetypes) == 0 {
		t.Fatalf("expected archetypes to load")
	}
	if len(catalog.Weapons) == 0 {
		t.Fatalf("expected weapons to load")
	}
	//2.- Verify the decoy balance exposes a positive activation window.
	decoy := DecoyBalance()
	if decoy.ActivationDurationSeconds <= 0 {
		t.Fatalf("expected decoy activation duration to be positive")
	}
}
