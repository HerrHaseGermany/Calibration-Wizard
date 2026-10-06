import test from "node:test";
import assert from "node:assert/strict";
import {positionGrid, positionMap, adjustment} from "../frontend/assets/positions.mjs";

test("measurement order VL, VR, HR, HL becomes a top view", () => {
  const grid = positionGrid([
    {id: "screw1", x: 0, y: 0}, {id: "screw2", x: 200, y: 0},
    {id: "screw3", x: 200, y: 200}, {id: "screw4", x: 0, y: 200},
  ]);
  assert.deepEqual(grid.points.map(p => [p.column, p.row]), [[1,2], [2,2], [2,1], [1,1]]);
});

test("six screws preserve the middle row and a three point gantry stays triangular", () => {
  const six = positionGrid([0, 100, 200].flatMap(y => [0, 200].map(x => ({x,y}))));
  assert.equal(six.rows, 3);
  assert.equal(six.columns, 2);
  const three = positionGrid([{x:-20,y:0}, {x:220,y:0}, {x:100,y:250}]);
  assert.deepEqual(three.points.map(p => [p.column,p.row]), [[1,2],[3,2],[2,1]]);
});

test("rotation arrows match Klipper signs and reference has no arrow", () => {
  assert.match(adjustment({sign:"CW",adjust:"00:15"}), /↻.*CW 00:15/);
  assert.match(adjustment({sign:"CCW",adjust:"00:30"}), /↺.*CCW 00:30/);
  assert.doesNotMatch(adjustment({is_base:true,sign:"CW"}), /↻|↺/);
});

test("configuration names are escaped and results matched by screw ID", () => {
  const html = positionMap([{id:"screw2",name:'<img src=x>',x:20,y:30}], {
    screw1:{sign:"CW",adjust:"00:10"}, screw2:{sign:"CCW",adjust:"00:25"},
  });
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /↺.*CCW 00:25/);
  assert.doesNotMatch(html, /00:10/);
});
