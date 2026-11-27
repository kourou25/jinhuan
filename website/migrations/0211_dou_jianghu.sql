-- 「斗」改版为「大模型江湖」（2026-11-27）：玩家选主角；武器换成新的 16 把，旧编号按掉落顺序换成新编号
ALTER TABLE dou_heroes ADD COLUMN role TEXT;
UPDATE dou_heroes SET weapon = CASE weapon
  WHEN 'w_wood_sword' THEN 'w_code_sword' WHEN 'w_kitchen_blade' THEN 'w_selfie_staff' WHEN 'w_paper_fan' THEN 'w_emoji_darts'
  WHEN 'w_broom_staff' THEN 'w_keyboard_fist' WHEN 'w_ferry_spear' THEN 'w_scroll_fan' WHEN 'w_night_darts' THEN 'w_brush_spear'
  WHEN 'w_escort_fist' THEN 'w_taiji_fist' WHEN 'w_dune_blade' THEN 'w_moon_darts' WHEN 'w_frost_sword' THEN 'w_light_sword'
  WHEN 'w_miasma_darts' THEN 'w_wool_staff' WHEN 'w_river_spear' THEN 'w_rocket_fist' WHEN 'w_cliff_staff' THEN 'w_twin_fans'
  WHEN 'w_cloud_fan' THEN 'w_cable_spear' WHEN 'w_peak_fist' THEN 'w_gpu_blade' ELSE weapon END;
UPDATE dou_items SET item_id = CASE item_id
  WHEN 'w_wood_sword' THEN 'w_code_sword' WHEN 'w_kitchen_blade' THEN 'w_selfie_staff' WHEN 'w_paper_fan' THEN 'w_emoji_darts'
  WHEN 'w_broom_staff' THEN 'w_keyboard_fist' WHEN 'w_ferry_spear' THEN 'w_scroll_fan' WHEN 'w_night_darts' THEN 'w_brush_spear'
  WHEN 'w_escort_fist' THEN 'w_taiji_fist' WHEN 'w_dune_blade' THEN 'w_moon_darts' WHEN 'w_frost_sword' THEN 'w_light_sword'
  WHEN 'w_miasma_darts' THEN 'w_wool_staff' WHEN 'w_river_spear' THEN 'w_rocket_fist' WHEN 'w_cliff_staff' THEN 'w_twin_fans'
  WHEN 'w_cloud_fan' THEN 'w_cable_spear' WHEN 'w_peak_fist' THEN 'w_gpu_blade' ELSE item_id END
WHERE kind = 'weapon';
