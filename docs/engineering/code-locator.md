# Code Locator

Use this file to quickly start concrete fixes. For full system structure, see [Repo Map](repo-map.md).

After solving a recurring, subtle, or high-risk problem, update or add a recipe with:

- the problem or workflow;
- the first files to inspect;
- the files involved in the fix;
- the invariant or trap that mattered;
- the focused verification command.

## Common Change Recipes

### Add A New Tauri Command

1. Add Rust function with `#[tauri::command]` in `src-tauri/src/lib.rs`.
2. Add it to `tauri::generate_handler![...]` in `run`.
3. Add a wrapper in `src/tauri-api.ts`.
4. Add or update types in `src/types.ts`.
5. Call it from `src/App.tsx`.
6. Run `npm run build` and `cargo test`.

### Add A New Config Field

1. Add the field to Rust config structs in `src-tauri/src/lib.rs`.
2. Add frontend type fields in `src/types.ts` if exposed to UI.
3. Update `app-data/default/links.toml` example/default profile config if needed.
4. Update the owning docs, [Repo Map](repo-map.md) if structure changed, and this code locator when the fix creates a reusable recipe.
5. Do not add legacy aliases unless explicitly requested.

### Change Link Preview Behavior

1. Start in Rust:
   - `build_action_plan`
   - `append_enable_actions`
   - `append_remove_actions`
2. Update frontend explanations:
   - `PlanDialog`
   - `PlanExplanation`
3. Verify with:
   - `npm run build`
   - `cd src-tauri; cargo test`

### Change Mapping Tree Display

1. Update tree data:
   - `buildLinkTree`
   - `buildLinkTreeNodes`
   - `attachMappingRoots`
2. Update rendering:
   - `MappingTree`
   - `MappingRootSourceCell`
   - `MappingRootTargetCell`
3. Check source/target tree modes and free-link behavior.
4. In source mode, keep real Data Repo and Virtual Data Repo hierarchy intact: generated mappings sit under their Data Repo or Independent Mapping Root folder, not directly under the top-level group.
