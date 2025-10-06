export type Damageable = { hp: number, onDeath?: () => void }
export function applyDamage(target: Damageable, amount: number){
  target.hp -= amount
  if (target.hp <= 0) target.onDeath?.()
}
