import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  PUBLISHABLE_PLUGIN_SETTINGS,
  createEmptyProject,
  redactProjectCredentials,
  serializeProject,
} from "@geolibre/core";
import {
  GEOLENS_PROJECT_STATE_KEYS,
  getGeoLensProjectState,
  normalizeGeoLensProjectState,
  setGeoLensProjectState,
} from "../packages/plugins/src/plugins/geolens-project-state";
import {
  GEOLENS_PLUGIN_ID,
  maplibreGeoLensPlugin,
} from "../packages/plugins/src/plugins/maplibre-geolens";
import type { GeoLibreAppAPI } from "../packages/plugins/src/types";

const app = {} as GeoLibreAppAPI;
const DATASET_KEY = "geolibre-7c2f1c0e-3b0a-4d6e-9a53-1f0d9d6a2b11";
const MAP_KEY = "geolibre-map-0b7d4e1f-6a2c-4f88-9d3e-5c1a2b8e7f90";

const saved = {
  serverUrl: "https://demo.getgeolens.com",
  mapKey: MAP_KEY,
  layerKeys: { "layer-1": DATASET_KEY },
};

afterEach(() => setGeoLensProjectState(undefined));

describe("GeoLens plugin project state", () => {
  it("round-trips through the plugin hooks", () => {
    maplibreGeoLensPlugin.applyProjectState?.(app, saved);
    assert.deepEqual(maplibreGeoLensPlugin.getProjectState?.(), saved);
  });

  it("saves nothing when there is nothing to remember", () => {
    assert.equal(maplibreGeoLensPlugin.getProjectState?.(), undefined);
  });

  it("clears the previous project's keys when a project without them loads", () => {
    maplibreGeoLensPlugin.applyProjectState?.(app, saved);
    assert.equal(maplibreGeoLensPlugin.clearsStateOnProjectLoad, true);
    maplibreGeoLensPlugin.applyProjectState?.(app, undefined);
    assert.equal(maplibreGeoLensPlugin.getProjectState?.(), undefined);
  });

  it("never holds a key, whatever a project file carries under the plugin id", () => {
    maplibreGeoLensPlugin.applyProjectState?.(app, {
      ...saved,
      apiKey: "gl_live_secret",
      token: "bearer-secret",
      layerKeys: { "layer-1": DATASET_KEY, "layer-2": "GL-Live-Secret" },
    });
    const state = maplibreGeoLensPlugin.getProjectState?.() as Record<string, unknown>;
    assert.deepEqual(Object.keys(state).sort(), [...GEOLENS_PROJECT_STATE_KEYS].sort());
    assert.ok(!/secret/i.test(JSON.stringify(state)));
    assert.deepEqual(state.layerKeys, { "layer-1": DATASET_KEY });
  });

  it("drops a server URL that carries credentials", () => {
    for (const serverUrl of [
      "https://user:pw@demo.getgeolens.com",
      "https://demo.getgeolens.com/?api_key=secret",
      "https://demo.getgeolens.com/#token=secret",
      "javascript:alert(1)",
      42,
    ]) {
      assert.equal(normalizeGeoLensProjectState({ serverUrl }).serverUrl, "");
    }
  });

  it("rejects values that are not publish keys", () => {
    const state = normalizeGeoLensProjectState({
      serverUrl: saved.serverUrl,
      mapKey: "Has Spaces",
      layerKeys: { a: "UPPER", b: 7, c: "ok-key" },
    });
    assert.equal(state.mapKey, null);
    assert.deepEqual(state.layerKeys, { c: "ok-key" });
  });

  it("keeps nothing when there is no valid server URL for the keys to belong to", () => {
    for (const serverUrl of ["https://user:pw@x.example/?k=1", "", undefined, 42]) {
      const state = normalizeGeoLensProjectState({
        serverUrl,
        mapKey: MAP_KEY,
        layerKeys: { "layer-1": DATASET_KEY },
      });
      assert.deepEqual(state, { serverUrl: "", mapKey: null, layerKeys: {} });
    }
    setGeoLensProjectState({ mapKey: MAP_KEY, layerKeys: { "layer-1": DATASET_KEY } });
    assert.equal(maplibreGeoLensPlugin.getProjectState?.(), undefined);
  });

  it("hands out a copy, so callers cannot edit the stored mapping", () => {
    setGeoLensProjectState(saved);
    getGeoLensProjectState().layerKeys["layer-1"] = "changed";
    assert.equal(getGeoLensProjectState().layerKeys["layer-1"], DATASET_KEY);
  });
});

describe("GeoLens plugin state in a saved or exported project", () => {
  it("lists explicit sub-keys, never the whole blob", () => {
    assert.deepEqual(PUBLISHABLE_PLUGIN_SETTINGS[GEOLENS_PLUGIN_ID], [
      ...GEOLENS_PROJECT_STATE_KEYS,
    ]);
  });

  it("keeps the publish keys and strips anything else stored under the plugin id", () => {
    const original = createEmptyProject("Publish fixture");
    original.plugins = {
      manifestUrls: [],
      activePluginIds: [GEOLENS_PLUGIN_ID],
      mapControlPositions: {},
      settings: {
        [GEOLENS_PLUGIN_ID]: { ...saved, apiKey: "gl_live_secret", session: "bearer-secret" },
      },
    };
    const { project } = redactProjectCredentials(original);
    assert.deepEqual(project.plugins!.settings[GEOLENS_PLUGIN_ID], saved);
    const text = serializeProject(project);
    assert.ok(!text.includes("gl_live_secret"));
    assert.ok(!text.includes("bearer-secret"));
  });

  it("does not report the publish keys as credentials", () => {
    const original = createEmptyProject("Publish fixture");
    original.plugins = {
      manifestUrls: [],
      activePluginIds: [],
      mapControlPositions: {},
      settings: { [GEOLENS_PLUGIN_ID]: saved },
    };
    assert.equal(redactProjectCredentials(original).redactedCount, 0);
  });
});
