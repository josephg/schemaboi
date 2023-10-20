# 0.3.0:

- Changed package from commonjs to esm

# 0.2.0:

- Fixed `scbcat` to output larger documents better and output maps correctly
- Rewrote structs to be semantically identical to enums with 1 variant
- Fixed a bunch of error messages
- Exported sb.String / sb.Id / sb.Bool types directly
- Added `encodeEntry` and `decodeEntry` mapping functions for maps
- Made the `decodeType` of objects / maps a required field (after I kept getting surprised by the default)
- Refactored bijective-varint code into its own package
- Fixed `read()` to return remote schema instead of merged schema. Made read method take an optional type argument for overriding / specifying the root type being read.
- Exported `testhelpers.ts` helper methods to make sure your types can round-trip correctly.
- Flattened AppEnumSchema to not need `associatedData` field
- Removed `type: 'struct'` declaration in `AppSchema`
- Restricted list type to an SType for its field type. Added `sb.list(type)` helper method.
- Made schema root optional


# 0.1.1:

- Added `scbcat` script
- Changed typescript to output commonjs (urgh) for better nodejs compatibility

# 0.1.0:

- First published version! Woo!