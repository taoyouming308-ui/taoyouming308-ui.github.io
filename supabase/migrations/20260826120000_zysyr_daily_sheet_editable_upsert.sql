-- v435 二期：日报表所有空格可修改填写（签字/未结单号/备注/公司行/员工姓名）
-- 1) 扩展 cell_role 校验：新增签字、未结单号、备注、支付表前缀角色
alter table public.zysyr_daily_sheet_cells
  drop constraint if exists zysyr_daily_sheet_cells_cell_role_check;
alter table public.zysyr_daily_sheet_cells
  add constraint zysyr_daily_sheet_cells_cell_role_check check (
    cell_role in (
      'staff_value', 'staff_total', 'staff_count', 'category_total',
      'technician_value', 'technician_total', 'technician_category_total',
      'product_value', 'product_total', 'summary_value', 'summary_actual',
      'summary_grand', 'payment_method', 'payment_cashflow',
      'payment_card_consumption', 'payment_total',
      'signature', 'unclosed_order', 'note', 'payment_nail',
      'payment_product', 'payment_subtotal'
    )
  );

-- 2) 文本单元格（签字/未结单号/备注/公司行）存储列
alter table public.zysyr_daily_sheet_cells
  add column if not exists manual_text text;

-- 文本和改名也必须保存修改前后值，不能只记录数值变化。
alter table public.zysyr_daily_sheet_cell_changes
  add column if not exists before_text text,
  add column if not exists after_text text,
  add column if not exists before_label text,
  add column if not exists after_label text;

-- 3) 保存 RPC：支持按 (draft, section, row_key, column_code) 位置 upsert，
--    并允许修改 row_label（员工姓名）与 manual_text（文本格）。
create or replace function public.zysyr_save_daily_sheet_cells(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_draft_id uuid,
  p_cells jsonb, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.zysyr_daily_sheet_drafts;
  v_item jsonb;
  v_cell public.zysyr_daily_sheet_cells;
  v_before numeric;
  v_after numeric;
  v_text_before text;
  v_text_after text;
  v_label_before text;
  v_label_after text;
  v_section text;
  v_row_key text;
  v_column_code text;
  v_role text;
  v_has_value boolean;
  v_numeric_changed boolean;
  v_text_changed boolean;
  v_label_changed boolean;
  v_revision integer;
  v_changed integer := 0;
  v_label_changes integer := 0;
  v_validation jsonb;
begin
  perform zysyr_private.assert_daily_entry_scope(p_actor_user_id, p_company_id, p_store_id);
  if jsonb_typeof(p_cells) <> 'array' or jsonb_array_length(p_cells) not between 1 and 1000
    or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'DAILY_SHEET_EDIT_INPUT_INVALID';
  end if;
  select * into v_draft from public.zysyr_daily_sheet_drafts draft
  where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.id = p_draft_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
  if v_draft.status <> 'draft' then raise exception using errcode = '55000', message = 'DAILY_SHEET_DRAFT_NOT_EDITABLE'; end if;
  v_revision := v_draft.edit_revision + 1;

  for v_item in select value from jsonb_array_elements(p_cells) loop
    v_section := nullif(btrim(coalesce(v_item->>'section_code', '')), '');
    v_row_key := nullif(btrim(coalesce(v_item->>'row_key', '')), '');
    v_column_code := nullif(btrim(coalesce(v_item->>'column_code', '')), '');
    v_role := nullif(btrim(coalesce(v_item->>'cell_role', '')), '');
    v_label_after := nullif(btrim(coalesce(v_item->>'row_label', '')), '');
    -- JSON null 表示用户明确清空。仅缺少 value 键才表示本次不修改值。
    v_has_value := v_item ? 'value';

    if coalesce(v_item->>'id', '') <> '' then
      select * into v_cell from public.zysyr_daily_sheet_cells cell
      where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
        and cell.id = (v_item->>'id')::uuid for update;
      if not found then raise exception using errcode = 'P0002', message = 'DAILY_SHEET_CELL_NOT_FOUND'; end if;
      -- 已有单元格的类型和逻辑位置必须以数据库为准，不能信任客户端角色。
      v_section := v_cell.section_code;
      v_row_key := v_cell.row_key;
      v_column_code := v_cell.column_code;
      v_role := v_cell.cell_role;
    else
      if v_section is null or v_row_key is null or v_column_code is null or v_role is null then
        raise exception using errcode = '22023', message = 'DAILY_SHEET_CELL_INPUT_INVALID';
      end if;
      if not (v_has_value or v_label_after is not null) then
        continue;
      end if;
      select * into v_cell from public.zysyr_daily_sheet_cells cell
      where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
        and cell.section_code = v_section and cell.row_key = v_row_key and cell.column_code = v_column_code
      for update;
      if not found then
        if (v_item->>'value') is null and v_label_after is null then
          continue;
        end if;
        insert into public.zysyr_daily_sheet_cells(
          company_id, store_id, draft_id, section_code, row_key, row_label,
          column_code, column_label, row_number, column_number, cell_role,
          source_method, updated_by_user_id
        ) values (
          p_company_id, p_store_id, p_draft_id, v_section, v_row_key,
          coalesce(v_label_after, '未命名'),
          v_column_code,
          coalesce(nullif(btrim(coalesce(v_item->>'column_label', '')), ''), '未命名列'),
          coalesce(nullif(v_item->>'row_number', '')::integer, 1),
          coalesce(nullif(v_item->>'column_number', '')::integer, 1),
          v_role, 'blank_template', p_actor_user_id
        ) returning * into v_cell;
      end if;
    end if;

    v_before := zysyr_private.daily_sheet_cell_value(v_cell);
    v_text_before := v_cell.manual_text;
    v_label_before := v_cell.row_label;
    v_text_after := v_text_before;
    v_after := v_before;
    v_numeric_changed := false;
    v_text_changed := false;
    v_label_changed := false;

    if v_has_value then
      if v_role in ('signature', 'unclosed_order', 'note') then
        v_text_after := nullif(v_item->>'value', '');
        if v_text_after is not null and char_length(v_text_after) > 500 then
          raise exception using errcode = '22023', message = 'DAILY_SHEET_TEXT_INVALID';
        end if;
        v_text_changed := v_text_before is distinct from v_text_after;
      else
        v_after := nullif(v_item->>'value', '')::numeric;
        if v_after is not null and v_after < 0 then
          raise exception using errcode = '22023', message = 'DAILY_SHEET_VALUE_INVALID';
        end if;
        v_numeric_changed := v_before is distinct from v_after;
      end if;
    end if;

    if v_label_after is not null and v_label_after <> v_label_before then
      v_label_changed := true;
      update public.zysyr_daily_sheet_cells set row_label = v_label_after,
        updated_by_user_id = p_actor_user_id, updated_at = now()
      where company_id = p_company_id and store_id = p_store_id and draft_id = p_draft_id
        and section_code = v_section and row_key = v_row_key;
    end if;

    if v_numeric_changed or v_text_changed then
      update public.zysyr_daily_sheet_cells set corrected_numeric = v_after, manual_text = v_text_after,
        manual_override = true, updated_by_user_id = p_actor_user_id, updated_at = now() where id = v_cell.id;
    end if;

    if v_numeric_changed or v_text_changed or v_label_changed then
      insert into public.zysyr_daily_sheet_cell_changes(company_id, store_id, draft_id, cell_id,
        revision, before_value, after_value, before_text, after_text, before_label, after_label,
        changed_by_user_id, reason)
      values(p_company_id, p_store_id, p_draft_id, v_cell.id, v_revision,
        v_before, v_after, v_text_before, v_text_after, v_label_before,
        case when v_label_changed then v_label_after else v_label_before end,
        p_actor_user_id, btrim(p_reason));
      v_changed := v_changed + 1;
    end if;
    if v_label_changed then
      v_label_changes := v_label_changes + 1;
    end if;
  end loop;

  if v_changed = 0 then
    return jsonb_build_object('draft_id', p_draft_id, 'revision', v_draft.edit_revision,
      'changed_cells', 0, 'label_changes', 0, 'validation', v_draft.validation_result);
  end if;

  v_validation := zysyr_private.daily_sheet_validation(p_company_id, p_store_id, p_draft_id);
  update public.zysyr_daily_sheet_drafts set edit_revision = v_revision, validation_result = v_validation,
    updated_by_user_id = p_actor_user_id, updated_at = now() where id = p_draft_id;
  insert into public.zysyr_audit_events(company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity)
  values(p_company_id, p_store_id, 'user', p_actor_user_id, 'api', 'daily_sheet_draft', p_draft_id,
    'edit', jsonb_build_object('revision', v_draft.edit_revision),
    jsonb_build_object('revision', v_revision, 'changed_cells', v_changed,
      'label_changes', v_label_changes, 'validation', v_validation),
    btrim(p_reason), 'financial');
  return jsonb_build_object('draft_id', p_draft_id, 'revision', v_revision,
    'changed_cells', v_changed, 'label_changes', v_label_changes, 'validation', v_validation);
end
$$;

revoke execute on function public.zysyr_save_daily_sheet_cells(uuid, uuid, uuid, uuid, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.zysyr_save_daily_sheet_cells(uuid, uuid, uuid, uuid, jsonb, text)
  to service_role;
