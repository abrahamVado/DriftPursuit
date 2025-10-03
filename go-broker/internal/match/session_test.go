package match

import (
	"testing"
	"time"
)

func TestNewSessionLoadsEnvironmentCapacity(t *testing.T) {
	t.Setenv(envMatchID, "alpha")
	t.Setenv(envMatchMinPlayers, "2")
	t.Setenv(envMatchMaxPlayers, "8")

	clock := func() time.Time { return time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC) }
	session, err := NewSession(WithSessionClock(clock))
	if err != nil {
		t.Fatalf("new session: %v", err)
	}

	snapshot := session.Snapshot()
	if snapshot.MatchID != "alpha" {
		t.Fatalf("unexpected match id: %q", snapshot.MatchID)
	}
	if snapshot.Capacity.MinPlayers != 2 || snapshot.Capacity.MaxPlayers != 8 {
		t.Fatalf("unexpected capacity: %+v", snapshot.Capacity)
	}
}

func TestJoinAndLeavePreservesMatchState(t *testing.T) {
	session, err := NewSession(
		WithSessionMatchID("persistent"),
		WithSessionCapacity(Capacity{MinPlayers: 1, MaxPlayers: 2}),
		WithSessionClock(func() time.Time { return time.Unix(0, 0) }),
		WithSessionEnvLookup(nil),
	)
	if err != nil {
		t.Fatalf("new session: %v", err)
	}

	if _, err := session.Join("player-1"); err != nil {
		t.Fatalf("join player-1: %v", err)
	}
	if _, err := session.Join("player-2"); err != nil {
		t.Fatalf("join player-2: %v", err)
	}
	if _, err := session.Join("player-3"); err != ErrMatchFull {
		t.Fatalf("expected match full error, got %v", err)
	}

	afterLeave := session.Leave("player-2")
	if len(afterLeave.ActivePlayers) != 1 || afterLeave.ActivePlayers[0] != "player-1" {
		t.Fatalf("unexpected roster after leave: %+v", afterLeave.ActivePlayers)
	}

	snapshot, err := session.Join("player-2")
	if err != nil {
		t.Fatalf("rejoin player-2: %v", err)
	}
	if snapshot.MatchID != "persistent" {
		t.Fatalf("match id changed after rejoin: %q", snapshot.MatchID)
	}
	if len(snapshot.ActivePlayers) != 2 {
		t.Fatalf("unexpected roster size: %+v", snapshot.ActivePlayers)
	}
}

func TestAdjustCapacityValidations(t *testing.T) {
	session, err := NewSession(
		WithSessionMatchID("beta"),
		WithSessionCapacity(Capacity{MinPlayers: 0, MaxPlayers: 3}),
		WithSessionEnvLookup(nil),
	)
	if err != nil {
		t.Fatalf("new session: %v", err)
	}
	for _, id := range []string{"a", "b", "c"} {
		if _, err := session.Join(id); err != nil {
			t.Fatalf("join %s: %v", id, err)
		}
	}

	if _, err := session.AdjustCapacity(0, 2); err == nil {
		t.Fatalf("expected error when shrinking below active participants")
	}

	updated, err := session.AdjustCapacity(1, 4)
	if err != nil {
		t.Fatalf("adjust capacity: %v", err)
	}
	if updated.Capacity.MinPlayers != 1 || updated.Capacity.MaxPlayers != 4 {
		t.Fatalf("unexpected capacity: %+v", updated.Capacity)
	}
}
