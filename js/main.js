import { Biome, BiomeMode } from "./biomes.js";
import { Factions, seedPointsFor, seedFactions } from "./world.js";
import { economyTick } from "./economy.js";

      (function () {
        "use strict";
        // ---------- Error overlay ----------
        window.addEventListener("error", function (e) {
          var msg = (e && e.error && e.error.stack) || e.message || String(e);
          var box = document.getElementById("err");
          if (box) {
            box.style.display = "block";
            box.textContent = msg;
          }
        });
        window.addEventListener("unhandledrejection", function (e) {
          var msg = (e && e.reason && e.reason.stack) || e.reason || String(e);
          var box = document.getElementById("err");
          if (box) {
            box.style.display = "block";
            box.textContent = msg;
          }
        });

        // ---------- DOM refs ----------
        var stage = document.getElementById("stage");
        var FLAT = document.getElementById("flat");
        var fctx = FLAT.getContext("2d");
        var MINI = document.getElementById("mini");
        var mctx = MINI.getContext("2d");
        var startBtn = document.getElementById("start");
        var biomeSel = document.getElementById("biomeSel");
        var sizeSel = document.getElementById("sizeSel");
        var cityPanel = document.getElementById("cityPanel");
        var tilePanel = document.getElementById("tilePanel");
        var ERR = document.getElementById("err");
        var HUD = {
          gold: document.getElementById("hud-gold"),
          food: document.getElementById("hud-food"),
          wood: document.getElementById("hud-wood"),
          stone: document.getElementById("hud-stone"),
          pop: document.getElementById("hud-pop"),
          stability: document.getElementById("hud-stability"),
          prestige: document.getElementById("hud-prestige"),
          score: document.getElementById("hud-score"),
        };

        // ---------- Core state ----------
        var TILE = 1;
        var WORLD = { w: 0, h: 0, data: [], elev: [], moist: [], owner: [] };
        function idx(x, y) {
          return y * WORLD.w + x;
        }
        var RND = Math.random;
        var THREE_OK = typeof window.THREE !== "undefined";
        var renderer = null,
          scene = null,
          camera = null,
          raycaster = null,
          mouse = null;
        var hemi = null,
          sun = null,
          rayPlane = null,
          selection = null,
          waterMat = null,
          worldOrigin = null,
          WGLReady = false;
        var renderCache = {};
        var tSec = 0;
        var using2D = false;
        var borderGroup = null,
          borderAnims = [];
        var playerFID = 0;
        var BORDER_R_INIT = 1; // radius 1 => 9 tiles total

        // ---------- Math helpers ----------
        var clamp = function (v, a, b) {
          return v < a ? a : v > b ? b : v;
        };
        var smooth = function (t) {
          return t * t * (3 - 2 * t);
        };

        function disposeNode(o) {
          if (!o) return;
          if (o.geometry && o.geometry.dispose) o.geometry.dispose();
          if (o.material) {
            var arr = Array.isArray(o.material) ? o.material : [o.material];
            for (var i = 0; i < arr.length; i++) {
              var m = arr[i];
              if (m && m.dispose) m.dispose();
            }
          }
        }
        function clearGroup(g) {
          if (!g) return;
          g.traverse(disposeNode);
          if (g.parent) g.parent.remove(g);
        }

        // ---------- THREE scene ----------
        function makeRenderer() {
          renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
          renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
          renderer.setSize(stage.clientWidth, stage.clientHeight);
          renderer.setClearColor(0x0e1522, 1);
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 1.12;
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          if ("outputColorSpace" in renderer)
            renderer.outputColorSpace = THREE.SRGBColorSpace;
          stage.prepend(renderer.domElement);
          renderer.domElement.style.touchAction = "none";
        }
        function makeScene() {
          scene = new THREE.Scene();
          scene.fog = new THREE.Fog(0x0e1522, 60, 140);
          camera = new THREE.PerspectiveCamera(
            55,
            stage.clientWidth / stage.clientHeight,
            0.1,
            1200,
          );
          camera.position.set(60, 50, 60);
          camera.lookAt(0, 0, 0);
          hemi = new THREE.HemisphereLight(0xcde3ff, 0x0c1422, 0.95);
          scene.add(hemi);
          sun = new THREE.DirectionalLight(0xfff4da, 1.25);
          sun.position.set(80, 120, 40);
          sun.castShadow = true;
          scene.add(sun);
          scene.add(sun.target);
          sun.shadow.mapSize.set(2048, 2048);
          sun.shadow.bias = -0.0005;
          sun.shadow.normalBias = 0.02;
          var ground = new THREE.Mesh(
            new THREE.PlaneGeometry(2000, 2000),
            new THREE.MeshStandardMaterial({ color: 0x0f1b2b, roughness: 1 }),
          );
          ground.rotation.x = -Math.PI / 2;
          ground.position.y = -0.05;
          ground.receiveShadow = true;
          scene.add(ground);
          selection = new THREE.Mesh(
            new THREE.PlaneGeometry(1.02, 1.02),
            new THREE.MeshBasicMaterial({
              color: 0xffff66,
              transparent: true,
              opacity: 0.45,
            }),
          );
          selection.rotation.x = -Math.PI / 2;
          selection.visible = false;
          selection.renderOrder = 95;
          scene.add(selection);
        }
        function configureSunForWorld(w, h) {
          var R = Math.max(w, h) * 0.6;
          var cam = sun.shadow.camera;
          sun.target.position.set(0, 0, 0);
          sun.target.updateMatrixWorld();
          cam.left = -R;
          cam.right = R;
          cam.top = R;
          cam.bottom = -R;
          cam.near = 1;
          cam.far = 300;
          cam.updateProjectionMatrix();
        }

        function onResize() {
          if (using2D) {
            resize2D();
            return;
          }
          if (!renderer || !camera) return;
          renderer.setSize(stage.clientWidth, stage.clientHeight);
          camera.aspect = stage.clientWidth / stage.clientHeight;
          camera.updateProjectionMatrix();
          MINI.width = 180;
          MINI.height = 128;
          if (mctx) mctx.imageSmoothingEnabled = false;
          drawMini();
        }
        addEventListener("resize", onResize, { passive: true });

        // ---------- Pixel textures & water ----------
        function makePixelTex(kind) {
          var S = 32,
            c = document.createElement("canvas");
          c.width = c.height = S;
          var ctx = c.getContext("2d");
          var px = function (x, y, col) {
            ctx.fillStyle = col;
            ctx.fillRect(x, y, 1, 1);
          };
          if (kind === "grass") {
            for (var y = 0; y < S; y++)
              for (var x = 0; x < S; x++) {
                var n = (Math.sin(x * 2.2) + Math.cos(y * 1.9)) * 0.5;
                var g = 110 + (((n + 1) * 16) | 0);
                px(
                  x,
                  y,
                  "rgb(" + (g - 18) + "," + (g + 50) + "," + (g - 5) + ")",
                );
              }
          }
          if (kind === "forest") {
            for (var y2 = 0; y2 < S; y2++)
              for (var x2 = 0; x2 < S; x2++) {
                var n2 = (Math.sin(x2 * 1.6) + Math.cos(y2 * 2.0)) * 0.5;
                var g2 = 72 + (((n2 + 1) * 12) | 0);
                px(
                  x2,
                  y2,
                  "rgb(" + (g2 - 25) + "," + (g2 + 28) + "," + (g2 - 8) + ")",
                );
              }
          }
          if (kind === "mount") {
            for (var y3 = 0; y3 < S; y3++)
              for (var x3 = 0; x3 < S; x3++) {
                var n3 = (Math.sin(x3 * 1.1) + Math.cos(y3 * 1.3)) * 0.5;
                var g3 = 130 + (((n3 + 1) * 26) | 0);
                px(
                  x3,
                  y3,
                  "rgb(" + (g3 + 25) + "," + (g3 - 12) + "," + (g3 - 35) + ")",
                );
              }
          }
          var tex = new THREE.CanvasTexture(c);
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.NearestFilter;
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.colorSpace = THREE.SRGBColorSpace;
          return tex;
        }
        function makeWaterMaterial() {
          return new THREE.ShaderMaterial({
            uniforms: {
              u_time: { value: 0 },
              u_colorTop: { value: new THREE.Color(0x53b2ff) },
              u_colorBottom: { value: new THREE.Color(0x1a4fa8) },
              u_opacity: { value: 0.9 },
            },
            vertexShader:
              "uniform float u_time; varying vec3 vN; varying vec3 vW; void main(){ vec3 p=position; p.y+= (sin((p.x+u_time*0.6)*2.0)+cos((p.y-u_time*0.5)*1.7))*0.035; vec4 wp=modelMatrix*vec4(p,1.0); vW=wp.xyz; vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*viewMatrix*wp; }",
            fragmentShader:
              "precision highp float; uniform vec3 u_colorTop,u_colorBottom; uniform float u_opacity; varying vec3 vN; varying vec3 vW; void main(){ vec3 N=normalize(vN); float fres=pow(1.0-max(dot(normalize(cameraPosition-vW),N),0.0),3.0); float grad=clamp(N.y*0.5+0.5,0.0,1.0); vec3 col=mix(u_colorBottom,u_colorTop,grad)+vec3(0.25)*fres; gl_FragColor=vec4(col,u_opacity);}",
            transparent: true,
            depthWrite: false,
          });
        }

        // ---------- Noise fields ----------
        function r215(x, y) {
          return (
            ((Math.sin((x * 183.97 + y * 127.63) * 43758.5453) % 1) + 1) % 1
          );
        }
        function v15(x, y) {
          var xi = Math.floor(x),
            yi = Math.floor(y),
            xf = x - xi,
            yf = y - yi,
            s = function (t) {
              return t * t * (3 - 2 * t);
            },
            n = function (a, b) {
              return r215(xi + a, yi + b);
            };
          var x1 = n(0, 0) * (1 - s(xf)) + n(1, 0) * s(xf),
            x2 = n(0, 1) * (1 - s(xf)) + n(1, 1) * s(xf);
          return x1 * (1 - s(yf)) + x2 * s(yf);
        }
        function fbm(x, y, o) {
          var f = 0,
            a = 1,
            s = 0;
          for (var i = 0; i < o; i++) {
            f += v15(x, y) * a;
            s += a;
            x *= 1.9;
            y *= 1.9;
            a *= 0.5;
          }
          return f / s;
        }
        var bilerp = function (a00, a10, a01, a11, tx, ty) {
          var a0 = a00 * (1 - tx) + a10 * tx,
            a1 = a01 * (1 - tx) + a11 * tx;
          return a0 * (1 - ty) + a1 * ty;
        };
        function fields(w, h, ox, oy) {
          var e = new Array(w * h),
            m = new Array(w * h);
          for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++) {
              var nx = (x + ox) * 0.065,
                ny = (y + oy) * 0.065;
              var el = fbm(nx, ny, 4);
              el =
                el * 0.8 +
                Math.abs(fbm(nx * 2 + 5, ny * 0.7 - 3, 3) - 0.5) * 0.6;
              e[idx(x, y)] = Math.max(0, Math.min(1, el));
              m[idx(x, y)] = fbm(nx + 12.3, ny - 7.7, 4);
            }
          return { elev: e, moist: m };
        }

        // ---------- Biome distribution (percent-driven) ----------
        function biomePercents(mode) {
          switch (mode) {
            case BiomeMode.PLAIN:
              return { grass: 0.8, forest: 0.1, water: 0.08, mount: 0.02 };
            case BiomeMode.SEA:
              return { grass: 0.18, forest: 0.1, water: 0.7, mount: 0.02 };
            case BiomeMode.FOREST:
              return { grass: 0.16, forest: 0.75, water: 0.07, mount: 0.02 };
            case BiomeMode.MOUNTAIN:
              return { grass: 0.25, forest: 0.14, water: 0.11, mount: 0.5 };
            default:
              return { grass: 0.45, forest: 0.25, water: 0.2, mount: 0.05 };
          }
        }
        function normalizePercents(p) {
          var clamp01 = function (v) {
            return Math.max(0, Math.min(1, v));
          };
          var g = clamp01(p.grass),
            f = clamp01(p.forest),
            w = clamp01(p.water),
            m = clamp01(p.mount);
          var s = g + f + w + m;
          if (Math.abs(s - 1) > 1e-6) {
            g /= s;
            f /= s;
            w /= s;
            m /= s;
          }
          return { grass: g, forest: f, water: w, mount: m };
        }

        // ---------- Capital island mask to avoid 1-tile islands ----------
        function carveIslandMask(cx, cy, mask) {
          var w = WORLD.w,
            h = WORLD.h;
          var R0 = 1.35,
            R1 = Math.max(w, h) >= 48 ? 2.2 : Math.max(w, h) >= 32 ? 2.0 : 1.8;
          var kx = 0.9,
            ky = 0.9;
          var x0 = Math.max(1, Math.floor(cx - R1 - 2)),
            x1 = Math.min(w - 2, Math.ceil(cx + R1 + 2)),
            y0 = Math.max(1, Math.floor(cy - R1 - 2)),
            y1 = Math.min(h - 2, Math.ceil(cy + R1 + 2));
          for (var y = 0; y <= y1 - y0; y++)
            for (var x = 0; x <= x1 - x0; x++) {
              var gx = x + x0,
                gy = y + y0;
              var dx = gx - cx,
                dy = gy - cy;
              var r = Math.hypot(dx, dy);
              if (r <= R0) {
                mask[idx(gx, gy)] = 1;
                continue;
              }
              if (r < R1) {
                var n = fbm((gx * 1.7 + 13.1) * kx, (gy * 1.7 - 9.2) * ky, 3);
                var edge = Math.max(0, Math.min(1, (R1 - r) / (R1 - R0)));
                var th = 0.58 - 0.32 * edge;
                if (n > th) mask[idx(gx, gy)] = 1;
              }
            }
          for (var oy = 0; oy <= 1; oy++)
            for (var ox = 0; ox <= 1; ox++) {
              var gx2 = cx + ox,
                gy2 = cy + oy;
              if (gx2 > 0 && gy2 > 0 && gx2 < w && gy2 < h)
                mask[idx(gx2, gy2)] = 1;
            }
        }

        // ---------- Map generation ----------
        function genMap(w, h, mode, capPts) {
          WORLD.w = w;
          WORLD.h = h;
          var N = w * h;
          WORLD.data = new Array(N).fill(Biome.GRASS);
          WORLD.elev = new Array(N).fill(0);
          WORLD.moist = new Array(N).fill(0);
          WORLD.owner = new Array(N).fill(-1);
          var P = normalizePercents(biomePercents(mode || BiomeMode.NORMAL));
          var nWater = Math.round(P.water * N),
            nMount = Math.round(P.mount * N),
            nForest = Math.round(P.forest * N);
          var SEED = (RND() * 10000) | 0;
          var QTL = fields(w, h, (SEED % 211) + 7, ((SEED * 13) % 223) + 11),
            QTR = fields(
              w,
              h,
              ((SEED * 7) % 239) + 37,
              ((SEED * 17) % 227) + 23,
            ),
            QBL = fields(
              w,
              h,
              ((SEED * 5) % 251) + 41,
              ((SEED * 19) % 241) + 31,
            ),
            QBR = fields(
              w,
              h,
              ((SEED * 11) % 257) + 61,
              ((SEED * 23) % 263) + 29,
            );
          for (var y = 0; y < h; y++) {
            var ty = smooth(y / (h - 1));
            for (var x = 0; x < w; x++) {
              var tx = smooth(x / (w - 1));
              var i = y * w + x;
              var e = bilerp(
                QTL.elev[i],
                QTR.elev[i],
                QBL.elev[i],
                QBR.elev[i],
                tx,
                ty,
              );
              var m = bilerp(
                QTL.moist[i],
                QTR.moist[i],
                QBL.moist[i],
                QBR.moist[i],
                tx,
                ty,
              );
              WORLD.elev[i] = e;
              WORLD.moist[i] = m;
            }
          }
          var waterForbid = new Uint8Array(N);
          if (Array.isArray(capPts))
            for (var c = 0; c < capPts.length; c++)
              carveIslandMask(capPts[c].x, capPts[c].y, waterForbid);
          var taken = new Uint8Array(N);
          function takeTop(count, scoreFn, type) {
            if (count <= 0) return;
            var arr = [];
            for (var i2 = 0; i2 < N; i2++)
              if (!taken[i2]) arr.push({ i: i2, s: scoreFn(i2) });
            arr.sort(function (a, b) {
              return b.s - a.s;
            });
            var lim = Math.min(count, arr.length);
            for (var k = 0; k < lim; k++) {
              var ii = arr[k].i;
              WORLD.data[ii] = type;
              taken[ii] = 1;
            }
          }
          function takeTopFiltered(count, scoreFn, type, forbid) {
            if (count <= 0) return 0;
            var arr = [];
            for (var i3 = 0; i3 < N; i3++)
              if (!taken[i3] && (!forbid || !forbid[i3]))
                arr.push({ i: i3, s: scoreFn(i3) });
            arr.sort(function (a, b) {
              return b.s - a.s;
            });
            var lim = Math.min(count, arr.length);
            for (var k2 = 0; k2 < lim; k2++) {
              var ii2 = arr[k2].i;
              WORLD.data[ii2] = type;
              taken[ii2] = 1;
            }
            return lim;
          }
          var sWater = function (i4) {
            return (
              (1 - WORLD.elev[i4]) * 0.65 + Math.max(0, WORLD.moist[i4]) * 0.35
            );
          };
          var sMount = function (i5) {
            return WORLD.elev[i5];
          };
          var sForest = function (i6) {
            return WORLD.moist[i6];
          };
          takeTopFiltered(nWater, sWater, Biome.LAKE, waterForbid);
          takeTop(nMount, sMount, Biome.MOUNTAIN);
          takeTop(nForest, sForest, Biome.FOREST);
          for (var i7 = 0; i7 < N; i7++)
            if (!taken[i7]) WORLD.data[i7] = Biome.GRASS;
        }

        function smoothPolyline3D(points, radius, arcSteps) {
          if (points.length < 3) return points.slice();
          var out = [];
          var r = Math.max(0.001, radius || 0.18);
          var steps = Math.max(2, arcSteps || 5);
          out.push(points[0].clone());
          for (var i = 1; i < points.length - 1; i++) {
            var p0 = points[i - 1],
              p1 = points[i],
              p2 = points[i + 1];
            var d0 = dir2(p0, p1),
              d1 = dir2(p1, p2);
            if (!isCorner(d0, d1)) {
              out.push(p1.clone());
              continue;
            }
            var inPt = p1
              .clone()
              .add(new THREE.Vector3(-d0.x * r, 0, -d0.z * r));
            var outPt = p1
              .clone()
              .add(new THREE.Vector3(d1.x * r, 0, d1.z * r));
            var cx = p1.x + (-d0.x + d1.x) * r;
            var cz = p1.z + (-d0.z + d1.z) * r;
            var startAng = Math.atan2(-d0.z, -d0.x);
            var endAng = Math.atan2(d1.z, d1.x);
            var angDiff = endAng - startAng;
            if (angDiff > Math.PI) angDiff -= 2 * Math.PI;
            if (angDiff < -Math.PI) angDiff += 2 * Math.PI;
            var step = angDiff / steps;
            out.push(inPt);
            for (var s = 1; s < steps; s++) {
              var a = startAng + step * s;
              out.push(
                new THREE.Vector3(cx, p1.y, cz).add(
                  new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r),
                ),
              );
            }
            out.push(outPt);
          }
          out.push(points[points.length - 1].clone());
          return out;
        }

        // ---------- Border extraction & drawing (3D) ----------
        // helpers to test ownership around grid vertices, used for marching-squares style mid-edge path
        function vertexOwned(fid, vx, vy) {
          var adj = [
            [vx - 1, vy - 1],
            [vx, vy - 1],
            [vx - 1, vy],
            [vx, vy],
          ];
          for (var i = 0; i < adj.length; i++) {
            var ax = adj[i][0],
              ay = adj[i][1];
            if (
              ax >= 0 &&
              ay >= 0 &&
              ax < WORLD.w &&
              ay < WORLD.h &&
              WORLD.owner[idx(ax, ay)] === fid
            )
              return 1;
          }
          return 0;
        }
        function msSegments(fid) {
          var w = WORLD.w,
            h = WORLD.h,
            y0 = 0.07,
            segs = [];
          var ox = worldOrigin.x,
            oz = worldOrigin.z;
          function wp(vx, vy) {
            return new THREE.Vector3(
              ox + (vx - 0.5) * TILE,
              y0,
              oz + (vy - 0.5) * TILE,
            );
          }
          for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++) {
              var tl = vertexOwned(fid, x, y),
                tr = vertexOwned(fid, x + 1, y),
                br = vertexOwned(fid, x + 1, y + 1),
                bl = vertexOwned(fid, x, y + 1);
              var m = (tl ? 1 : 0) | (tr ? 2 : 0) | (br ? 4 : 0) | (bl ? 8 : 0);
              if (m === 0 || m === 15) continue;
              var P = [
                wp(x + 0.5, y),
                wp(x + 1, y + 0.5),
                wp(x + 0.5, y + 1),
                wp(x, y + 0.5),
              ];
              function add(e0, e1) {
                segs.push({ a: P[e0], b: P[e1] });
              }
              switch (m) {
                case 1:
                  add(3, 0);
                  break;
                case 2:
                  add(0, 1);
                  break;
                case 3:
                  add(3, 1);
                  break;
                case 4:
                  add(1, 2);
                  break;
                case 5:
                  add(3, 2);
                  add(0, 1);
                  break;
                case 6:
                  add(0, 2);
                  break;
                case 7:
                  add(3, 2);
                  break;
                case 8:
                  add(2, 3);
                  break;
                case 9:
                  add(2, 0);
                  break;
                case 10:
                  add(0, 3);
                  add(1, 2);
                  break;
                case 11:
                  add(1, 2);
                  break;
                case 12:
                  add(1, 3);
                  break;
                case 13:
                  add(0, 1);
                  break;
                case 14:
                  add(3, 0);
                  break;
              }
            }
          return segs;
        }
        function insideDirFor(fid, mid) {
          var tx = Math.round((mid.x - worldOrigin.x) / TILE),
            ty = Math.round((mid.z - worldOrigin.z) / TILE);
          var acc = new THREE.Vector3();
          for (var j = -1; j <= 1; j++)
            for (var i = -1; i <= 1; i++) {
              var gx = tx + i,
                gy = ty + j;
              if (gx < 0 || gy < 0 || gx >= WORLD.w || gy >= WORLD.h) continue;
              if (WORLD.owner[idx(gx, gy)] === fid) {
                acc.x += worldOrigin.x + gx * TILE - mid.x;
                acc.z += worldOrigin.z + gy * TILE - mid.z;
              }
            }
          if (acc.lengthSq() < 1e-6) {
            var cap = Factions[fid].cap;
            acc.set(
              worldOrigin.x + cap.x * TILE - mid.x,
              0,
              worldOrigin.z + cap.y * TILE - mid.z,
            );
          }
          acc.y = 0;
          acc.normalize();
          return acc;
        }
        function buildTubeInstanced(segments, color, rad, offsetIn, fid) {
          var n = segments.length;
          if (!n) return null;
          var geo =
            renderCache.tubeGeo ||
            (renderCache.tubeGeo = new THREE.CylinderGeometry(
              1,
              1,
              1,
              14,
              1,
              true,
            ));
          var mat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.92,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
          });
          var im = new THREE.InstancedMesh(geo, mat, n);
          var up = new THREE.Vector3(0, 1, 0),
            q = new THREE.Quaternion(),
            m4 = new THREE.Matrix4(),
            s = new THREE.Vector3();
          for (var i = 0; i < n; i++) {
            var a = segments[i].a,
              b = segments[i].b,
              mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
              dir = new THREE.Vector3().subVectors(b, a),
              axis = new THREE.Vector3(dir.x, 0, dir.z);
            var len = Math.max(1e-4, axis.length());
            axis.normalize();
            var nrm = new THREE.Vector3().crossVectors(axis, up);
            var inDir = insideDirFor(fid, mid);
            if (nrm.dot(inDir) < 0) nrm.multiplyScalar(-1);
            var pos = new THREE.Vector3()
              .copy(mid)
              .addScaledVector(nrm, offsetIn || 0.06);
            q.setFromUnitVectors(up, axis);
            s.set(rad || 0.065, len, rad || 0.065);
            m4.compose(pos, q, s);
            im.setMatrixAt(i, m4);
          }
          im.instanceMatrix.needsUpdate = true;
          im.renderOrder = 80;
          return im;
        }
        function segKey(a, b) {
          function r(v) {
            return [Math.round(v.x * 500) / 500, Math.round(v.z * 500) / 500];
          }
          var aR = r(a),
            bR = r(b);
          var k1 = aR.join(",") + "|" + bR.join(","),
            k2 = bR.join(",") + "|" + aR.join(",");
          return aR[0] < bR[0] || (aR[0] === bR[0] && aR[1] <= bR[1]) ? k1 : k2;
        }
        function segKeySetFor(fid) {
          var set = new Set();
          var segs = msSegments(fid);
          for (var i = 0; i < segs.length; i++)
            set.add(segKey(segs[i].a, segs[i].b));
          return set;
        }
        function newSegmentsFor(fid, before) {
          var add = [];
          var segs = msSegments(fid);
          for (var i = 0; i < segs.length; i++) {
            var k = segKey(segs[i].a, segs[i].b);
            if (!before.has(k)) add.push(segs[i]);
          }
          return add;
        }
        function key3(v) {
          return v.x.toFixed(3) + "," + v.z.toFixed(3);
        }
        function chainSegments3D(segs) {
          var map = new Map(),
            used = new Array(segs.length).fill(false);
          for (var i = 0; i < segs.length; i++) {
            var a = key3(segs[i].a),
              b = key3(segs[i].b);
            if (!map.has(a)) map.set(a, []);
            if (!map.has(b)) map.set(b, []);
            map.get(a).push(i);
            map.get(b).push(i);
          }
          var polys = [];
          for (var s = 0; s < segs.length; s++) {
            if (used[s]) continue;
            used[s] = true;
            var a0 = segs[s].a.clone(),
              b0 = segs[s].b.clone();
            var poly = [a0.clone(), b0.clone()];
            var end = b0.clone(),
              start = a0.clone();
            var ek = key3(end);
            while (true) {
              var arr = map.get(ek) || [];
              var next = -1;
              for (var j = 0; j < arr.length; j++) {
                var id = arr[j];
                if (used[id]) continue;
                var sg = segs[id];
                if (key3(sg.a) === ek || key3(sg.b) === ek) {
                  next = id;
                  break;
                }
              }
              if (next < 0) break;
              used[next] = true;
              var sg2 = segs[next];
              var nv = key3(sg2.a) === ek ? sg2.b.clone() : sg2.a.clone();
              poly.push(nv);
              end = nv;
              ek = key3(end);
            }
            var sk = key3(start);
            while (true) {
              var arr2 = map.get(sk) || [];
              var next2 = -1;
              for (var j2 = 0; j2 < arr2.length; j2++) {
                var id2 = arr2[j2];
                if (used[id2]) continue;
                var sg3 = segs[id2];
                if (key3(sg3.a) === sk || key3(sg3.b) === sk) {
                  next2 = id2;
                  break;
                }
              }
              if (next2 < 0) break;
              used[next2] = true;
              var sg4 = segs[next2];
              var nv2 = key3(sg4.a) === sk ? sg4.b.clone() : sg4.a.clone();
              poly.unshift(nv2);
              start = nv2;
              sk = key3(start);
            }
            polys.push(poly);
          }
          return polys;
        }
        // PolylineCurve3 shim for older refs
        if (typeof window.PolylineCurve3 === "undefined") {
          window.PolylineCurve3 = function (points, closed) {
            return new THREE.CatmullRomCurve3(
              points,
              !!closed,
              "centripetal",
              1.0,
            );
          };
        }
        function tubeFromPolyline(points, color, rad) {
          if (points.length < 2) return null;
          var curve = new THREE.CatmullRomCurve3(
            points,
            false,
            "centripetal",
            1.0,
          );
          var tubular = Math.max(16, Math.floor(points.length * 4));
          var geo = new THREE.TubeGeometry(curve, tubular, rad, 16, false);
          var mat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.92,
            blending: THREE.AdditiveBlending,
            depthTest: false,
            depthWrite: false,
          });
          var mesh = new THREE.Mesh(geo, mat);
          mesh.renderOrder = 92;
          return mesh;
        }
        function rebuildBordersSmooth() {
          clearGroup(borderGroup);
          borderGroup = new THREE.Group();
          for (var i = 0; i < Factions.length; i++) {
            var F = Factions[i];
            var segs = msSegments(F.id);
            if (!segs.length) continue;
            var tube = buildTubeInstanced(segs, F.color, 0.065, 0.06, F.id);
            if (tube) borderGroup.add(tube);
          }
          scene.add(borderGroup);
        }

        // ---------- Annex animations ----------

        function playAnnexGrowTile(tileX, tileY, color) {
          var e = WORLD.elev[idx(tileX, tileY)] * 0.12;
          var px = worldOrigin.x + tileX * TILE,
            pz = worldOrigin.z + tileY * TILE;
          var plane = new THREE.Mesh(
            new THREE.PlaneGeometry(1.06, 1.06),
            new THREE.MeshBasicMaterial({
              color: color,
              transparent: true,
              opacity: 0.35,
              blending: THREE.AdditiveBlending,
              depthTest: false,
              depthWrite: false,
            }),
          );
          plane.rotation.x = -Math.PI / 2;
          plane.position.set(px, e + 0.031, pz);
          plane.scale.set(0.1, 0.1, 0.1);
          plane.renderOrder = 93;
          scene.add(plane);
          borderAnims.push({ type: "tilefill", node: plane, t: 0, dur: 600 });
        }
        function playBorderGrowSegments(segments, color) {
          if (!segments.length) return;
          var polys = chainSegments3D(segments);
          for (var p = 0; p < polys.length; p++) {
            var group = tubeFromPolyline(polys[p], color, 0.065);
            if (!group) continue;
            group.scale.setScalar(0.2);
            group.children.forEach(function (m) {
              m.material.opacity = 0.0;
            });
            group.renderOrder = 96;
            scene.add(group);
            borderAnims.push({ type: "grow", node: group, t: 0, dur: 800 });
          }
        }

        // ---------- 3D tiles/objects ----------
        var tilesGroup = null,
          playerCrown = null;
        function instancedFrom(geom, mat, transforms) {
          var n = transforms.length;
          if (!n) return null;
          var im = new THREE.InstancedMesh(geom, mat, n);
          var m4 = new THREE.Matrix4();
          for (var i = 0; i < n; i++) {
            im.setMatrixAt(i, transforms[i]);
          }
          im.instanceMatrix.needsUpdate = true;
          im.castShadow = im.receiveShadow = true;
          return im;
        }
        function makeCrown(color) {
          var g = new THREE.Group();
          var gold = new THREE.MeshStandardMaterial({
            color: color,
            metalness: 0.9,
            roughness: 0.25,
            emissive: new THREE.Color(color).multiplyScalar(0.25),
          });
          var band = new THREE.Mesh(
            new THREE.TorusGeometry(0.24, 0.045, 18, 48),
            gold,
          );
          band.rotation.x = Math.PI / 2;
          g.add(band);
          var prongG = new THREE.ConeGeometry(0.07, 0.22, 10);
          for (var i = 0; i < 5; i++) {
            var a = i * ((Math.PI * 2) / 5);
            var pr = new THREE.Mesh(prongG, gold.clone());
            pr.position.set(Math.cos(a) * 0.24, 0.16, Math.sin(a) * 0.24);
            pr.castShadow = pr.receiveShadow = true;
            g.add(pr);
            var gem = new THREE.Mesh(
              new THREE.SphereGeometry(0.03, 16, 16),
              new THREE.MeshStandardMaterial({
                color: 0xffffbb,
                emissive: 0xffee88,
                emissiveIntensity: 0.9,
                roughness: 0.2,
              }),
            );
            gem.position.set(Math.cos(a) * 0.24, 0.3, Math.sin(a) * 0.24);
            g.add(gem);
          }
          return g;
        }
        function buildWorldMeshes() {
          clearGroup(tilesGroup);
          tilesGroup = new THREE.Group();
          scene.add(tilesGroup);
          var w = WORLD.w,
            h = WORLD.h;
          var ox = -w * TILE * 0.5 + TILE * 0.5,
            oz = -h * TILE * 0.5 + TILE * 0.5;
          worldOrigin = new THREE.Vector3(ox, 0, oz);
          var texGrass =
              renderCache.texGrass ||
              (renderCache.texGrass = makePixelTex("grass")),
            texForest =
              renderCache.texForest ||
              (renderCache.texForest = makePixelTex("forest")),
            texMount =
              renderCache.texMount ||
              (renderCache.texMount = makePixelTex("mount"));
          var gBox =
            renderCache.gBox ||
            (renderCache.gBox = new THREE.BoxGeometry(
              TILE * 1.01,
              0.04,
              TILE * 1.01,
            ));
          var matGrass =
            renderCache.matGrass ||
            (renderCache.matGrass = new THREE.MeshStandardMaterial({
              map: texGrass,
              roughness: 0.85,
              metalness: 0.05,
            }));
          var matForest =
            renderCache.matForest ||
            (renderCache.matForest = new THREE.MeshStandardMaterial({
              map: texForest,
              roughness: 0.9,
              metalness: 0.05,
            }));
          var matMount =
            renderCache.matMount ||
            (renderCache.matMount = new THREE.MeshStandardMaterial({
              map: texMount,
              roughness: 0.6,
              metalness: 0.2,
            }));
          waterMat =
            renderCache.water || (renderCache.water = makeWaterMaterial());
          waterMat.side = THREE.DoubleSide;
          waterMat.polygonOffset = true;
          waterMat.polygonOffsetFactor = -1;
          waterMat.polygonOffsetUnits = -1;
          var q = new THREE.Quaternion(),
            s = new THREE.Vector3(1, 1, 1),
            m4 = new THREE.Matrix4();
          var Tgrass = [],
            Tforest = [],
            Tmount = [];
          var waterGroup = new THREE.Group();
          function push(arr, px, py, pz) {
            q.setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              (Math.floor(Math.random() * 4) * Math.PI) / 2,
            );
            m4.compose(new THREE.Vector3(px, py, pz), q, s);
            arr.push(m4.clone());
          }
          for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++) {
              var t = WORLD.data[idx(x, y)],
                y0 = WORLD.elev[idx(x, y)] * 0.12,
                px = ox + x * TILE,
                pz = oz + y * TILE;
              if (t === Biome.GRASS || t === Biome.BERRY)
                push(Tgrass, px, y0, pz);
              else if (t === Biome.FOREST) push(Tforest, px, y0, pz);
              else if (t === Biome.MOUNTAIN) push(Tmount, px, y0, pz);
              else if (t === Biome.LAKE || t === Biome.RIVER) {
                var pg = new THREE.PlaneGeometry(TILE * 1.06, TILE * 1.06);
                var pm = new THREE.Mesh(pg, waterMat);
                pm.rotation.x = -Math.PI / 2;
                pm.position.set(px, y0 + 0.03, pz);
                pm.renderOrder = 1;
                waterGroup.add(pm);
              }
            }
          var imGrass = instancedFrom(gBox, matGrass, Tgrass);
          if (imGrass) tilesGroup.add(imGrass);
          var imForest = instancedFrom(gBox, matForest, Tforest);
          if (imForest) tilesGroup.add(imForest);
          var imMount = instancedFrom(gBox, matMount, Tmount);
          if (imMount) tilesGroup.add(imMount);
          tilesGroup.add(waterGroup);
          var trunkG =
              renderCache.trunkG ||
              (renderCache.trunkG = new THREE.CylinderGeometry(
                0.05,
                0.06,
                0.25,
                6,
              )),
            leafG =
              renderCache.leafG ||
              (renderCache.leafG = new THREE.ConeGeometry(0.25, 0.6, 8));
          var trunkM =
              renderCache.trunkM ||
              (renderCache.trunkM = new THREE.MeshStandardMaterial({
                color: 0x6b4d2e,
                roughness: 0.7,
              })),
            leafM =
              renderCache.leafM ||
              (renderCache.leafM = new THREE.MeshStandardMaterial({
                color: 0x2f7b43,
                roughness: 0.6,
              }));
          var trunks = [],
            leaves = [];
          for (var y2 = 0; y2 < h; y2++)
            for (var x2 = 0; x2 < w; x2++)
              if (WORLD.data[idx(x2, y2)] === Biome.FOREST) {
                var y0b = WORLD.elev[idx(x2, y2)] * 0.12,
                  pxb = ox + x2 * TILE + (Math.random() - 0.5) * 0.2,
                  pzb = oz + y2 * TILE + (Math.random() - 0.5) * 0.2;
                trunks.push(
                  new THREE.Matrix4().compose(
                    new THREE.Vector3(pxb, y0b + 0.18, pzb),
                    new THREE.Quaternion(),
                    new THREE.Vector3(1, 1, 1),
                  ),
                );
                leaves.push(
                  new THREE.Matrix4().compose(
                    new THREE.Vector3(pxb, y0b + 0.55, pzb),
                    new THREE.Quaternion(),
                    new THREE.Vector3(1, 1, 1),
                  ),
                );
              }
          var imTrunks = instancedFrom(trunkG, trunkM, trunks);
          if (imTrunks) tilesGroup.add(imTrunks);
          var imLeaves = instancedFrom(leafG, leafM, leaves);
          if (imLeaves) tilesGroup.add(imLeaves);
          var rockG =
              renderCache.rockG ||
              (renderCache.rockG = new THREE.ConeGeometry(0.35, 0.35, 6)),
            rockM =
              renderCache.rockM ||
              (renderCache.rockM = new THREE.MeshStandardMaterial({
                color: 0x9aa3ad,
                roughness: 0.6,
                metalness: 0.1,
              }));
          var rocks = [];
          for (var y3 = 0; y3 < h; y3++)
            for (var x3 = 0; x3 < w; x3++)
              if (WORLD.data[idx(x3, y3)] === Biome.MOUNTAIN) {
                var y0c = WORLD.elev[idx(x3, y3)] * 0.12,
                  pxc = ox + x3 * TILE + (Math.random() - 0.5) * 0.15,
                  pzc = oz + y3 * TILE + (Math.random() - 0.5) * 0.15,
                  sR = 1.2 + Math.random() * 0.6;
                rocks.push(
                  new THREE.Matrix4().compose(
                    new THREE.Vector3(pxc, y0c + 0.18, pzc),
                    new THREE.Quaternion(),
                    new THREE.Vector3(sR, sR, sR),
                  ),
                );
              }
          var imRocks = instancedFrom(rockG, rockM, rocks);
          if (imRocks) tilesGroup.add(imRocks);
          var townG =
              renderCache.townG ||
              (renderCache.townG = new THREE.CylinderGeometry(
                0.22,
                0.22,
                0.35,
                8,
              )),
            roofG =
              renderCache.roofG ||
              (renderCache.roofG = new THREE.ConeGeometry(0.28, 0.28, 8));
          for (var ff = 0; ff < Factions.length; ff++) {
            var Fc = Factions[ff];
            var gx = worldOrigin.x + Fc.cap.x * TILE,
              gz = worldOrigin.z + Fc.cap.y * TILE;
            var base = new THREE.Mesh(
              townG,
              new THREE.MeshStandardMaterial({
                color: 0xc9b28a,
                roughness: 0.8,
              }),
            );
            var roof = new THREE.Mesh(
              roofG,
              new THREE.MeshStandardMaterial({
                color: Fc.color,
                roughness: 0.6,
                emissive: new THREE.Color(Fc.color).multiplyScalar(0.15),
              }),
            );
            base.position.set(gx, 0.22, gz);
            roof.position.set(gx, 0.51, gz);
            base.castShadow = roof.castShadow = true;
            tilesGroup.add(base, roof);
          }
          if (playerCrown) {
            scene.remove(playerCrown);
            playerCrown.traverse(disposeNode);
            playerCrown = null;
          }
          var cap = Factions[playerFID].cap;
          var eCap = WORLD.elev[idx(cap.x, cap.y)];
          var baseY = eCap * 0.12 + 0.78;
          playerCrown = makeCrown(0xffe066);
          playerCrown.position.set(
            worldOrigin.x + cap.x * TILE,
            baseY,
            worldOrigin.z + cap.y * TILE,
          );
          playerCrown.userData.baseY = baseY;
          playerCrown.renderOrder = 98;
          scene.add(playerCrown);
          if (rayPlane) {
            disposeNode(rayPlane);
            scene.remove(rayPlane);
          }
          rayPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(w * TILE, h * TILE),
            new THREE.MeshBasicMaterial({ visible: false }),
          );
          rayPlane.rotation.x = -Math.PI / 2;
          scene.add(rayPlane);
          configureSunForWorld(w * TILE, h * TILE);
        }

        // ---------- 2D fallback borders ----------
        function msSegments2D(fid) {
          var w = WORLD.w,
            h = WORLD.h,
            segs = [];
          for (var y = 0; y < h; y++)
            for (var x = 1; x < w; x++) {
              var a = WORLD.owner[idx(x - 1, y)] === fid,
                b = WORLD.owner[idx(x, y)] === fid;
              if (a !== b) segs.push({ x0: x, y0: y, x1: x, y1: y + 1 });
            }
          for (var x2 = 0; x2 < w; x2++)
            for (var y2 = 1; y2 < h; y2++) {
              var a2 = WORLD.owner[idx(x2, y2 - 1)] === fid,
                b2 = WORLD.owner[idx(x2, y2)] === fid;
              if (a2 !== b2) segs.push({ x0: x2, y0: y2, x1: x2 + 1, y1: y2 });
            }
          return segs;
        }
        function chainSegments2D(segs) {
          var key = function (x, y) {
            return x + "," + y;
          };
          var map = new Map(),
            used = new Array(segs.length).fill(false);
          for (var i = 0; i < segs.length; i++) {
            var a = key(segs[i].x0, segs[i].y0),
              b = key(segs[i].x1, segs[i].y1);
            if (!map.has(a)) map.set(a, []);
            if (!map.has(b)) map.set(b, []);
            map.get(a).push(i);
            map.get(b).push(i);
          }
          var polys = [];
          for (var s = 0; s < segs.length; s++) {
            if (used[s]) continue;
            used[s] = true;
            var a0 = { x: segs[s].x0, y: segs[s].y0 },
              b0 = { x: segs[s].x1, y: segs[s].y1 };
            var poly = [a0, b0];
            var end = b0,
              ek = key(end.x, end.y);
            while (true) {
              var arr = map.get(ek) || [];
              var next = -1;
              for (var j = 0; j < arr.length; j++) {
                var id = arr[j];
                if (used[id]) continue;
                var sg = segs[id];
                if (key(sg.x0, sg.y0) === ek || key(sg.x1, sg.y1) === ek) {
                  next = id;
                  break;
                }
              }
              if (next < 0) break;
              used[next] = true;
              var sg2 = segs[next];
              var nv =
                key(sg2.x0, sg2.y0) === ek
                  ? { x: sg2.x1, y: sg2.y1 }
                  : { x: sg2.x0, y: sg2.y0 };
              poly.push(nv);
              end = nv;
              ek = key(end.x, end.y);
            }
            polys.push(poly);
          }
          return polys;
        }
        function dir2D(a, b) {
          var dx = b.x - a.x,
            dy = b.y - a.y;
          return {
            x: dx === 0 ? 0 : dx > 0 ? 1 : -1,
            y: dy === 0 ? 0 : dy > 0 ? 1 : -1,
          };
        }
        function isCorner2D(d0, d1) {
          return (
            (d0.x !== d1.x || d0.y !== d1.y) &&
            !(d0.x === -d1.x && d0.y === -d1.y)
          );
        }
        function smoothPolyline2D(points, rUnits, steps) {
          if (points.length < 3) return points.slice();
          var out = [];
          var r = Math.max(0.001, rUnits || 0.18),
            st = Math.max(2, steps || 6);
          out.push({ x: points[0].x, y: points[0].y });
          for (var i = 1; i < points.length - 1; i++) {
            var p0 = points[i - 1],
              p1 = points[i],
              p2 = points[i + 1];
            var d0 = dir2D(p0, p1),
              d1 = dir2D(p1, p2);
            if (!isCorner2D(d0, d1)) {
              out.push({ x: p1.x, y: p1.y });
              continue;
            }
            var inPt = { x: p1.x - d0.x * r, y: p1.y - d0.y * r };
            var outPt = { x: p1.x + d1.x * r, y: p1.y + d1.y * r };
            var cx = p1.x + (-d0.x + d1.x) * r;
            var cy = p1.y + (-d0.y + d1.y) * r;
            var startAng = Math.atan2(-d0.y, -d0.x);
            var endAng = Math.atan2(d1.y, d1.x);
            var diff = endAng - startAng;
            if (diff > Math.PI) diff -= 2 * Math.PI;
            if (diff < -Math.PI) diff += 2 * Math.PI;
            var step = diff / st;
            out.push(inPt);
            for (var s = 1; s < st; s++) {
              var a = startAng + step * s;
              out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
            }
            out.push(outPt);
          }
          out.push({
            x: points[points.length - 1].x,
            y: points[points.length - 1].y,
          });
          return out;
        }
        function drawBorders2D() {
          var tw = FLAT.width / WORLD.w,
            th = FLAT.height / WORLD.h;
          for (var i = 0; i < Factions.length; i++) {
            var F = Factions[i];
            var segs = msSegments2D(F.id);
            var polys = chainSegments2D(segs);
            fctx.lineJoin = "round";
            fctx.lineCap = "round";
            fctx.strokeStyle = "#" + F.color.toString(16).padStart(6, "0");
            for (var p = 0; p < polys.length; p++) {
              var pts = polys[p];
              var sm = smoothPolyline2D(pts, 0.18, 6);
              fctx.beginPath();
              for (var j = 0; j < sm.length; j++) {
                var px = sm[j].x * tw,
                  py = sm[j].y * th;
                if (j === 0) fctx.moveTo(px, py);
                else fctx.lineTo(px, py);
              }
              fctx.lineWidth = Math.max(2, Math.min(tw, th) * 0.22);
              fctx.stroke();
            }
          }
        }

        // ---------- 2D world draw ----------
        function drawWorld2D() {
          FLAT.style.display = "block";
          FLAT.width = stage.clientWidth - 20;
          FLAT.height = stage.clientHeight - 20;
          fctx.imageSmoothingEnabled = false;
          var tw = FLAT.width / WORLD.w,
            th = FLAT.height / WORLD.h;
          fctx.clearRect(0, 0, FLAT.width, FLAT.height);
          for (var y = 0; y < WORLD.h; y++)
            for (var x = 0; x < WORLD.w; x++) {
              var t = WORLD.data[idx(x, y)];
              var col =
                t === Biome.GRASS
                  ? "#63c66d"
                  : t === Biome.FOREST
                    ? "#2c6b3b"
                    : t === Biome.MOUNTAIN
                      ? "#8b6e49"
                      : t === Biome.LAKE || t === Biome.RIVER
                        ? "#2b7dd8"
                        : "#63c66d";
              fctx.fillStyle = col;
              fctx.fillRect(x * tw, y * th, tw, th);
            }
          for (var i = 0; i < Factions.length; i++) {
            var F = Factions[i];
            var xpx = (F.cap.x + 0.1) * tw,
              ypx = (F.cap.y + 0.1) * th;
            fctx.fillStyle = "#c9b28a";
            fctx.fillRect(xpx, ypx, tw * 0.8, th * 0.5);
            fctx.fillStyle = "#" + F.color.toString(16).padStart(6, "0");
            fctx.fillRect(xpx, ypx - 0.25 * th, tw * 0.8, th * 0.25);
          }
          var cap = Factions[playerFID].cap;
          var xcx = cap.x * tw + tw * 0.5,
            ycy = cap.y * th - 0.35 * th;
          fctx.font =
            Math.floor(Math.max(12, th * 0.6)) + "px system-ui,Segoe UI,Roboto";
          fctx.textAlign = "center";
          fctx.fillStyle = "#ffe066";
          fctx.fillText("👑", xcx, ycy);
          drawBorders2D();
        }
        function resize2D() {
          FLAT.width = stage.clientWidth - 20;
          FLAT.height = stage.clientHeight - 20;
          MINI.width = 180;
          MINI.height = 128;
          if (mctx) mctx.imageSmoothingEnabled = false;
          drawWorld2D();
          drawMini();
        }

        // ---------- Minimap ----------
        function drawMini() {
          var w = (MINI.width = 180),
            h = (MINI.height = 128);
          mctx.imageSmoothingEnabled = false;
          var sx = w / WORLD.w,
            sy = h / WORLD.h;
          var pal = [
            0x63c66d, 0x2c6b3b, 0x3aa0ff, 0x8b6e49, 0x2b7dd8, 0xf4473b,
          ];
          mctx.clearRect(0, 0, w, h);
          for (var y = 0; y < WORLD.h; y++)
            for (var x = 0; x < WORLD.w; x++) {
              var col = pal[WORLD.data[idx(x, y)]];
              mctx.fillStyle = "#" + col.toString(16).padStart(6, "0");
              mctx.fillRect(x * sx, y * sy, sx, sy);
            }
          for (var i = 0; i < Factions.length; i++) {
            var F = Factions[i];
            mctx.fillStyle = "#" + F.color.toString(16).padStart(6, "0");
            mctx.fillRect(F.cap.x * sx - 1, F.cap.y * sy - 1, 3, 3);
          }
        }

        // ---------- HUD update ----------
        function updateHUD() {
          var P = Factions[playerFID];
          HUD.pop.textContent = P.pop | 0;
          HUD.food.textContent = P.res.food | 0;
          HUD.wood.textContent = P.res.wood | 0;
          HUD.gold.textContent = P.res.gold | 0;
          HUD.stone.textContent = P.res.stone | 0;
          HUD.stability.textContent = P.stability | 0;
          HUD.prestige.textContent = P.prestige | 0;
          HUD.score.textContent = P.score | 0;
        }

        // ---------- Tile helpers & panels ----------
        function ownerOfXY(x, y) {
          return WORLD.owner[idx(x, y)];
        }
        function isPlayerBorder(x, y) {
          var k = idx(x, y);
          if (WORLD.owner[k] === playerFID) return false;
          var D = [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ];
          for (var i = 0; i < D.length; i++) {
            var nx = x + D[i][0],
              ny = y + D[i][1];
            if (nx < 0 || ny < 0 || nx >= WORLD.w || ny >= WORLD.h) continue;
            if (WORLD.owner[idx(nx, ny)] === playerFID) return true;
          }
          return false;
        }

        // --- Icon helpers (emoji fallback, persistent once user uploads via previous manager) ---
        var ICONS = window.ICONS || {
          farm: null,
          lumber: null,
          fishing: null,
          stone: null,
          coal: null,
          iron: null,
          gold: null,
          village: null,
          town: null,
          city: null,
        };
        var EMOJI = {
          farm: "🌾",
          lumber: "🪵",
          fishing: "🐟",
          stone: "⛏️",
          coal: "🪨",
          iron: "⚙️",
          gold: "🪙",
          village: "🏡",
          town: "🏘️",
          city: "🏛️",
        };
        function emojiSVG(emo) {
          var svg =
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#183255'/><stop offset='1' stop-color='#0d1a2b'/></linearGradient></defs><rect width='64' height='64' rx='10' ry='10' fill='url(#g)' stroke='#3a5a84' stroke-width='3'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' font-size='34'>" +
            (emo || "❓") +
            "</text></svg>";
          return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
        }
        function iconURL(key) {
          return ICONS[key] || emojiSVG(EMOJI[key] || "❓");
        }
        function iconHTML(key, label, disabled) {
          var cls = disabled ? "disabled" : "";
          var imgHTML = ICONS[key]
            ? "<img src='" + iconURL(key) + "' alt='" + label + "'>"
            : "<span>" + (EMOJI[key] || "❓") + "</span>";
          return (
            '<div class="icon" title="' +
            label +
            '"><div class="icon-frame ' +
            cls +
            '">' +
            imgHTML +
            '</div><div class="icon-caption">' +
            label +
            "</div></div>"
          );
        }
        try {
          var _saved = localStorage.getItem("gs_icons");
          if (_saved) {
            var m = JSON.parse(_saved);
            for (var k in m) {
              ICONS[k] = m[k];
            }
          }
        } catch (_e) {}

        function biomeNameOf(x, y) {
          var t = WORLD.data[idx(x, y)];
          return t === Biome.GRASS
            ? "Çim"
            : t === Biome.FOREST
              ? "Orman"
              : t === Biome.MOUNTAIN
                ? "Dağ"
                : t === Biome.LAKE || t === Biome.RIVER
                  ? "Su"
                  : "Kare";
        }

        function showTilePanelXY(x, y) {
          var k = idx(x, y),
            who = ownerOfXY(x, y),
            own = who === playerFID;
          var enemyOwned = who >= 0 && who !== playerFID;
          var isPlayerCap =
            Factions[playerFID] &&
            Factions[playerFID].cap.x === x &&
            Factions[playerFID].cap.y === y;
          var title =
            (own
              ? "🏳️ Bizim kare"
              : enemyOwned
                ? "🚫 Başka ülkenin toprağı"
                : "❓ Keşfedilmemiş/kontrol dışı") +
            " — (" +
            x +
            "," +
            y +
            ")";
          var body = "";
          if (own) {
            body +=
              '<div class="row"><span class="hudChip">👥 Nüfus: <b>0</b></span><span class="hudChip">💰 Gelir: <b>0</b></span><span class="hudChip">💸 Gider: <b>0</b></span></div>';
            body +=
              '<div style="margin-top:8px"><b>🏙️ Yerleşim</b><div class="icon-grid">' +
              iconHTML("village", "Köy", !isPlayerCap) +
              iconHTML("town", "Kasaba", !isPlayerCap ? true : false) +
              iconHTML("city", "Şehir", true) +
              "</div></div>";
            body +=
              '<div style="margin-top:10px"><b>🛠️ Binalar</b><div class="icon-grid">' +
              iconHTML("farm", "Çiftlik", true) +
              iconHTML("lumber", "Keresteci", true) +
              iconHTML("fishing", "Balıkçılık", true) +
              iconHTML("stone", "Taş Madeni", true) +
              iconHTML("coal", "Kömür Madeni", true) +
              iconHTML("iron", "Demir Madeni", true) +
              iconHTML("gold", "Altın Madeni", true) +
              '</div><div style="opacity:.75;font-size:12px;margin-top:4px">(Şimdilik hepsi placeholder)</div></div>';
          } else {
            var can = isPlayerBorder(x, y) && !enemyOwned; // başka ülke toprağı ilhak edilemez
            body +=
              '<div class="row"><button class="pill" disabled>🔎 Keşfet (placeholder)</button>' +
              (can
                ? '<button class="pill" id="annexBtn">🏴 Kontrol Et (Sınırımıza kat)</button>'
                : '<button class="pill" disabled>🏴 Kontrol Et</button>') +
              "</div>";
            if (enemyOwned)
              body +=
                '<div style="margin-top:6px;opacity:.8">Savaş sistemi gelene kadar başka ülkenin toprağı ilhak edilemez.</div>';
            body +=
              '<div style="margin-top:10px"><b>📦 Mevcut/gelecek ikonlar</b><div class="icon-grid">' +
              iconHTML("farm", "Çiftlik", true) +
              iconHTML("lumber", "Keresteci", true) +
              iconHTML("fishing", "Balıkçılık", true) +
              iconHTML("stone", "Taş", true) +
              iconHTML("coal", "Kömür", true) +
              iconHTML("iron", "Demir", true) +
              iconHTML("gold", "Altın", true) +
              iconHTML("village", "Köy", true) +
              iconHTML("town", "Kasaba", true) +
              iconHTML("city", "Şehir", true) +
              "</div></div>";
          }
          body +=
            '<div style="text-align:right;margin-top:10px"><button class="pill" id="closeTile">Kapat</button></div>';
          tilePanel.innerHTML = "<h3>" + title + "</h3>" + body;
          tilePanel.style.display = "block";
          cityPanel.style.display = "none";
          document.getElementById("closeTile").onclick = function () {
            tilePanel.style.display = "none";
          };
          var annex = document.getElementById("annexBtn");
          if (annex) {
            annex.onclick = function () {
              if (using2D) {
                var before = msSegments2D(playerFID);
                var beforeSet = new Set();
                for (var s = 0; s < before.length; s++) {
                  beforeSet.add(
                    before[s].x0 +
                      "," +
                      before[s].y0 +
                      "|" +
                      before[s].x1 +
                      "," +
                      before[s].y1,
                  );
                }
                WORLD.owner[k] = playerFID;
                var after = msSegments2D(playerFID);
                var added = [];
                for (var s2 = 0; s2 < after.length; s2++) {
                  var key =
                    after[s2].x0 +
                    "," +
                    after[s2].y0 +
                    "|" +
                    after[s2].x1 +
                    "," +
                    after[s2].y1;
                  var rev =
                    after[s2].x1 +
                    "," +
                    after[s2].y1 +
                    "|" +
                    after[s2].x0 +
                    "," +
                    after[s2].y0;
                  if (!beforeSet.has(key) && !beforeSet.has(rev))
                    added.push(after[s2]);
                }
                tilePanel.style.display = "none";
                drawMini();
                drawWorld2D();
              } else {
                var beforeSegs = new Set(
                  msSegments(playerFID).map(function (s) {
                    return s.a.x + "," + s.a.z + "|" + s.b.x + "," + s.b.z;
                  }),
                );
                WORLD.owner[k] = playerFID;
                var after3 = msSegments(playerFID);
                var added3 = [];
                for (var i = 0; i < after3.length; i++) {
                  var s3 = after3[i];
                  var key3s =
                    s3.a.x + "," + s3.a.z + "|" + s3.b.x + "," + s3.b.z;
                  var key3r =
                    s3.b.x + "," + s3.b.z + "|" + s3.a.x + "," + s3.a.z;
                  if (!beforeSegs.has(key3s) && !beforeSegs.has(key3r))
                    added3.push(s3);
                }
                rebuildBordersSmooth();
                playAnnexGrowTile(x, y, Factions[playerFID].color);
                playBorderGrowSegments(added3, Factions[playerFID].color);
                tilePanel.style.display = "none";
                drawMini();
              }
            };
          }
        }

        // ---------- Input (3D) ----------
        function bindInput3D() {
          var el = renderer.domElement;
          var pointers = new Map();
          var pinchD0 = 0;
          var target = new THREE.Vector3(0, 0, 0);
          var camDist = 42;
          var camYaw = -Math.PI / 4,
            camPitch = 0.95;
          var downInfo = { x: 0, y: 0, moved: false, id: null };
          function updateCam() {
            camera.position.set(
              target.x + camDist * Math.cos(camYaw) * Math.cos(camPitch),
              target.y + camDist * Math.sin(camPitch),
              target.z + camDist * Math.sin(camYaw) * Math.cos(camPitch),
            );
            camera.lookAt(target);
          }
          function screenToWorldTile(clientX, clientY) {
            var r = renderer.domElement.getBoundingClientRect();
            mouse.x = ((clientX - r.left) / r.width) * 2 - 1;
            mouse.y = -((clientY - r.top) / r.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            var inter = raycaster.intersectObjects([rayPlane], true)[0];
            if (!inter) return null;
            var x = Math.round((inter.point.x - worldOrigin.x) / TILE),
              y = Math.round((inter.point.z - worldOrigin.z) / TILE);
            if (x < 0 || y < 0 || x >= WORLD.w || y >= WORLD.h) return null;
            return { x: x, y: y };
          }
          function handleClick(clientX, clientY) {
            var t = screenToWorldTile(clientX, clientY);
            if (!t) return;
            var y0 = WORLD.elev[idx(t.x, t.y)] * 0.12;
            selection.position.set(
              worldOrigin.x + t.x * TILE,
              y0 + 0.051,
              worldOrigin.z + t.y * TILE,
            );
            selection.visible = true;
            showTilePanelXY(t.x, t.y);
          }
          var opt = { passive: false };
          el.addEventListener(
            "pointerdown",
            function (e) {
              el.setPointerCapture(e.pointerId);
              pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
              downInfo = {
                x: e.clientX,
                y: e.clientY,
                moved: false,
                id: e.pointerId,
              };
              e.preventDefault();
            },
            opt,
          );
          el.addEventListener(
            "pointermove",
            function (e) {
              var p = pointers.get(e.pointerId);
              if (!p) return;
              var dx = e.clientX - p.x,
                dy = e.clientY - p.y;
              pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
              if (pointers.size === 1) {
                var dist = Math.hypot(
                  e.clientX - downInfo.x,
                  e.clientY - downInfo.y,
                );
                if (dist > 6) downInfo.moved = true;
                var k = 0.0025 * camDist;
                var forward = new THREE.Vector3();
                camera.getWorldDirection(forward);
                forward.y = 0;
                forward.normalize();
                var right = new THREE.Vector3();
                right
                  .crossVectors(forward, new THREE.Vector3(0, 1, 0))
                  .normalize();
                target.addScaledVector(right, -dx * k);
                target.addScaledVector(forward, dy * k);
                updateCam();
              } else if (pointers.size === 2) {
                downInfo.moved = true;
                var ps = Array.from(pointers.values());
                var d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
                if (!pinchD0) pinchD0 = d;
                camDist = clamp(camDist * (pinchD0 / d), 12, 180);
                pinchD0 = d;
                updateCam();
              }
              e.preventDefault();
            },
            opt,
          );
          function up(e) {
            pointers.delete(e.pointerId);
            if (pointers.size < 2) pinchD0 = 0;
            e.preventDefault();
            if (e.pointerId === downInfo.id) {
              var dist = Math.hypot(
                e.clientX - downInfo.x,
                e.clientY - downInfo.y,
              );
              var treatedAsClick = !downInfo.moved && dist <= 6;
              if (treatedAsClick) {
                handleClick(e.clientX, e.clientY);
              }
            }
          }
          el.addEventListener("pointerup", up, opt);
          el.addEventListener("pointercancel", up, opt);
          el.addEventListener(
            "wheel",
            function (e) {
              camDist = clamp(
                camDist * (1 + (e.deltaY > 0 ? 0.1 : -0.1)),
                12,
                180,
              );
              updateCam();
              e.preventDefault();
            },
            { passive: false },
          );
          el.addEventListener("dblclick", function (e) {
            var t = screenToWorldTile(e.clientX, e.clientY);
            if (t) {
              target.set(
                worldOrigin.x + t.x * TILE,
                0,
                worldOrigin.z + t.y * TILE,
              );
              updateCam();
            }
          });
          ["touchstart", "touchmove", "touchend"].forEach(function (ev) {
            el.addEventListener(
              ev,
              function (ev2) {
                return ev2.preventDefault();
              },
              { passive: false },
            );
          });
        }
        function bindInput2D() {
          FLAT.addEventListener("click", function (e) {
            var r = FLAT.getBoundingClientRect();
            var x = Math.floor(((e.clientX - r.left) / FLAT.width) * WORLD.w);
            var y = Math.floor(((e.clientY - r.top) / FLAT.height) * WORLD.h);
            if (x < 0 || y < 0 || x >= WORLD.w || y >= WORLD.h) return;
            showTilePanelXY(x, y);
          });
          window.addEventListener("resize", resize2D);
        }

        // ---------- Game start ----------
        function worldSizeFromSel() {
          var v = sizeSel.value;
          if (v === "small") return { w: 20, h: 20, cam: 28 };
          if (v === "medium") return { w: 30, h: 30, cam: 36 };
          return { w: 40, h: 40, cam: 48 };
        }
        function seedPointsAndGen() {
          var sz = worldSizeFromSel();
          var caps = seedPointsFor(sz.w, sz.h);
          genMap(sz.w, sz.h, biomeSel.value, caps);
          seedFactions(caps, WORLD, idx, playerFID, BORDER_R_INIT);
        }
        function startGame() {
          try {
            ERR.style.display = "none";
            seedPointsAndGen();
            updateHUD();
            if (THREE_OK) {
              raycaster = new THREE.Raycaster();
              mouse = new THREE.Vector2();
              worldOrigin = new (THREE.Vector3 || function () {})();
              makeRenderer();
              makeScene();
              bindInput3D();
              buildWorldMeshes();
              rebuildBordersSmooth();
              drawMini();
              tSec = 0;
              WGLReady = true;
              onResize();
            } else {
              using2D = true;
              resize2D();
              drawWorld2D();
              drawMini();
              bindInput2D();
            }
          } catch (e) {
            console.error(e);
            var msg = (e && e.stack) || String(e);
            ERR.style.display = "block";
            ERR.textContent = msg;
          }
        }
        startBtn.onclick = function () {
          startGame();
        };
        setTimeout(startGame, 120);

        // ---------- Main loop ----------
        var last = performance.now();
        var econTime = 0;
        function tick(t) {
          var dtms = t - last;
          last = t;
          econTime += dtms;
          if (econTime >= 1000) {
            economyTick(WORLD, idx);
            updateHUD();
            econTime = 0;
          }
          tSec += dtms / 1000;
          if (THREE_OK && waterMat && WGLReady)
            waterMat.uniforms.u_time.value += dtms / 1000;
          // crown rotation + bob
          if (playerCrown) {
            playerCrown.rotation.y += (dtms / 1000) * 1.2;
            var by = playerCrown.userData.baseY || playerCrown.position.y;
            playerCrown.position.y = by + Math.sin(tSec * 2.4) * 0.06;
          }
          // border anims
          for (var i = borderAnims.length - 1; i >= 0; i--) {
            var A = borderAnims[i];
            A.t += dtms;
            var k = Math.min(1, A.t / A.dur);
            if (A.type === "tilefill") {
              var e = 1 - Math.pow(1 - k, 3);
              A.node.scale.set(e, e, e);
              A.node.material.opacity = 0.35 * (1 - k);
              if (k >= 1) {
                scene.remove(A.node);
                A.node.traverse(disposeNode);
                borderAnims.splice(i, 1);
              }
            } else if (A.type === "grow") {
              var easeOut = 1 - Math.pow(1 - k, 3);
              var s = 0.2 + 0.8 * easeOut;
              A.node.scale.setScalar(s);
              A.node.children.forEach(function (m, idx) {
                m.material.opacity =
                  idx === 1 ? 0.25 + 0.65 * easeOut : 0.1 + 0.2 * easeOut;
              });
              if (k >= 1) {
                scene.remove(A.node);
                A.node.traverse(disposeNode);
                borderAnims.splice(i, 1);
              }
            }
          }

          if (using2D) {
            drawWorld2D();
          } else if (WGLReady) {
            renderer.render(scene, camera);
          }
          requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      })();
