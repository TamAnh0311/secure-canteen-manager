export function scannerOperatorScopeSql(sheetAlias: string, actorZoneParam: string): string {
  const room = `UPPER(REGEXP_REPLACE(COALESCE(${sheetAlias}.result_json #>> '{buong_giam,value}', ''), '[^A-Za-z0-9]', '', 'g'))`;
  const legacyId = `${sheetAlias}.result_json #>> '{ma_luu_ky,value}'`;
  return `(
    ${room} <> ''
    AND EXISTS (
      SELECT 1 FROM users room_user
      WHERE room_user.is_active = true
        AND room_user.normalized_cell = ${room}
        AND room_user.cell_normalization_version = 1
        AND BTRIM(room_user.zone) = :${actorZoneParam}
    )
    AND NOT EXISTS (
      SELECT 1 FROM users other_zone_room_user
      WHERE other_zone_room_user.is_active = true
        AND other_zone_room_user.normalized_cell = ${room}
        AND other_zone_room_user.cell_normalization_version = 1
        AND BTRIM(other_zone_room_user.zone) <> :${actorZoneParam}
    )
    AND NOT EXISTS (
      SELECT 1 FROM users id_conflict_user
      WHERE id_conflict_user.legacy_id = ${legacyId}
        AND (
          id_conflict_user.is_active = false
          OR BTRIM(id_conflict_user.zone) <> :${actorZoneParam}
        )
    )
  )`;
}
