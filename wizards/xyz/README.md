# XYZ travel check

The wizard measures axis travel directly with a dial indicator or securely mounted
caliper. It supports Cartesian, CoreXY and CoreXZ. It never changes stepper parameters.

- `frontend.mjs`: localized, guided setup, confirmed motion, measurement and results.
- `backend/src/calibration_wizard/xyz.py`: finite numeric validation, live position and
  bounds checks, motion with restored G-code state, repeated measurement evaluation.
- `xyzCalibration_cube.stl`: supplied 20 × 20 × 20 mm cube, offered as an optional
  print test. Printed dimensions do not determine axis rotation distance.

After homing, position the printer for the measurement in Mainsail. Keep at least
2 mm from all axis limits and a Z height of at least 5 mm. Each movement and return
is explicitly started. Cancel leaves the printer at its current position.

At least three measurements are needed per series with the same axis, distance
and direction. Results show mean travel
error, mean relative error and the range of errors. Repeatability comparisons need
the same distance and direction. The wizard does not measure squareness or backlash.

See https://www.klipper3d.org/Rotation_Distance.html for hardware-based axis settings.
