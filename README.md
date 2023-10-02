> **STATUS: EXPERIMENTAL**. Do not use this for anything you care about yet! Schemaboi is still in flux, and the binary representation may drift in mutually incompatible ways before 1.0.

# Schemaboi: A binary format with schema evolution

Schemaboi is an efficient binary serialization format (like protobuf) thats designed for applications with schemas that change over time. (Which is, basically every application).

Schemaboi has many of the same goals as Ink & Switch's [Project Cambria](https://www.inkandswitch.com/cambria/), to enable applications to interoperate despite their schemas changing over time.

Imagine two applications, both editing shared blog posts. One application wants to add a new `featured: bool` field to the data schema, marking featured blog posts.

- Using JSON, the schema can change in any way, but ad-hoc fields lead to messy, ad-hoc code that becomes increasingly buggy and messy over time.
- Using protobuf (or something similar), both application developers need to coordinate to decide which fields get added. This coordination overhead slows down development work - data formats are punished for their popularity!

Schemaboi solves this problem!

Every data format is described by a *Schema*. The schema describes 3 pieces of information:

1. **Encoding:** How the data is stored in binary form (on disk or over the network)
2. **Core Schema:** What types and fields are available
3. **Local Mapping:** How those fields map into your programming language (eg Javascript or Rust)

Schemaboi data files **embed the schema** (well, the encoding and core schema parts). Your application embeds the schema it expects (part 2 and 3). When a SB file is loaded, the stored data is mapped to your local types.

- Anything your application understands is validated and kept.
- Anything your application doesn't understand is stored separately, and re-encoded when the data is saved back to disk. Round-trips *never* lose data.

This enables:

- **Schema Evolution:** Data stored with schemaboi can be both forwards- *and backwards-* compatible with other application software. Application authors can add new fields to the schema at will. (Or remove (ignore) old ones). Any new data fields will be preserved by other applications, without interfering with how those apps work. Schemaboi is designed for applications that should still work without modification in 100 years from now.
2. **Encoding efficiency:** Unlike JSON, schemaboi has an extremely compact packed binary format. Data takes even fewer bytes over the wire than other binary formats like protobuf. (Though we do need to store the schema - but its usually small!)
3. **Self describing:** Data stored in schemaboi is self describing. Like JSON or msgpack, schemaboi data doesn't need a special out-of-band schema file in order to interpret the data. You can print any schemaboi file out as raw JSON, or edit it directly. (Though you will need our schemaboi CLI tool to do so). There is no special compilation step to use schemaboi.

Schemaboi also supports more data types than JSON, like opaque binary blobs and parametric enums, as found in modern languages like Swift, Rust, Typescript and Haskell. (Eg `enum Shape { Circle(centre, radius), Square(x, y, sidelength) }`).

A schemaboi file contains a strict tree of data, like JSON. There are no pointers in the structure.


## Schema merging

Most schema systems (protobuf, etc) don't deal well with schema changes. There are a lot of complex cases schema systems need to deal with to manage this:

1. A schema is modified from v1 to v2 with new fields being added. Old data is loaded by the application, and the new fields are missing.
2. A file is saved to disk (or in a database or something) using v2 of the application. This data is then loaded by some software that has not been updated to use the new schema. The application does not understand some fields. And the application must not delete any data when the file is saved.
3. In local first software, multiple application authors may independently add different features to their software. Rather than a linear series of schema changes (v1 -> v2 -> v3), versions can diverge. Eg, v0 -> vA and v0 -> vB. As much as possible, applications should ignore and preserve any fields they don't understand.

In schemaboi, when loading data we always (at runtime) have access to two schemas:

1. The **local schema**. This schema is embedded within the running application.
2. The **remote schema** - usually embedded with the data stored on disk or in a database, or transmitted over the network from a remote application.

If the remote and local schemas don't match, data is loaded as follows:

1. The schemas are *merged*. Generally, this means taking the union of all the enum variants and all the struct fields known by both applications. This may error (see below).
2. The data is loaded according to the merged schema.

When loading using the merged schema, we apply the following rules:

- Any struct fields not known by the local application are stored in a separate `foreign fields` chunk. (In javascript, this is stored in a special `{_foreign: {...}}` field.
- Any missing local struct fields are filled in with default values if possible, or if not the entire struct is considered foreign (see below).
- For enums, if the value has a variant not known to the local schema, it is considered foreign.

### Foreign data

If remote data cannot be loaded by the local application (because the enum variant is unknown, or required struct fields are missing) then the data is considered *foreign*. Foreign data bubbles up during parsing until it reaches one of two things:

1. An enum which supports foreign variants. The entire sub-tree of data will be stored as a *foreign variant* in the parent enum. Its then up to the application to decide how this is displayed. Eg, one application adds "video tweets". Another application doesn't support video tweets yet, and so it displays a message for foreign variants saying "@seph made a tweet using another client that we cannot display".
2. If foreign data reaches the root, the application generates a parse error.


### When can schemas be merged?

Schema merging is possible for most schema changes:

- New struct fields are added or removed.
- Enum variants are added or removed (though data using the new variants will not be understood by other applications).
- Enum variants can have fields added or removed. (Enum variants are a struct in disguise).
- Structs can be widened into enums. The original struct will be matched to the first enum variant.
- Required values become optional, or vice versa. (Optionals are really just an enum of Some(value) or None - so you can think of this as a struct to enum widening).

But some schema changes are illegal, and will cause errors with past versions of the application:

- Changing the type of a field (eg string to integer). For now the only exception is enums and structs can be swapped. (A struct is just an enum with 1 variant).
  - This means you can't do some of the things described in the cambria paper - like reinterpret a single value as a list.
  - The expectation is that every field has a unique name. If this worries you, use some form of unique field names (domain scoped, GUIDs, etc) and map them to readable names in the local mapping of your application.
- ??? (I bet there's more things this precludes..)

Note that part of the schema - the local mapping - describes how the stored data maps to types in your programming language. This information isn't stored with the data or shared between applications. Changes to the local mapping have no impact beyond your local application:

- Changing default values for fields
- Making enums support foreign variants
- Renaming fields (your application should keep the original field name on disk. The field is just mapped locally).


## Schemas are stored with the data

In schemaboi, all data is stored & sent with the schema used to generate that data. When data is stored on disk, the schema is stored with the data. And when SB is used as part of a network protocol, the schemas both peers use should be transmitted immediately once the connection is opened.

This has a pretty modest performance impact (schema information is usually very small - just a few kb at most). But it enables the schema migration features described above.

Schemaboi files on disk look like this:

```
[Magic??]
[Media type, schema and encoding information]
[Data]
```

This is a departure from formats like JSON and msgpack, which have the schema information (field names) repeated and interleaved throughout the data:

```
[field names + data, field names + data, field names + data]
```

Or protobuf and capnproto, which split the data and the schema into two separate data chunks:

```
myschema.proto:
[schema]

myfile.data:
[data]
```

This makes schemaboi *less efficient* for very small data sets. (Though the schema is usually pretty tiny). But much more efficient for very large data sets, where the cost of storing the schema information is amortized.

There are also a couple other advantages to doing this:

1. The schema can contain hints on how the data is encoded. We can get better compression efficiency in some cases.
2. By storing the schema information with the data, we can use generic SB tools to load, view and edit any SB data in a human-readable form (like JSON).

This approach also has a commensurate disadvantage with for compiled languages: The schema needs to be parsed (at runtime), so we can't use code generation to make a super efficient SB parser for each application in the general case.



## What is a schema?

In Schemaboi, there are 3 parts of any schema:

1. The set of *data types*. This is a set of struct and enum types which together describe the data to be stored. These types will normally correspond to classes (/ interfaces) and enums in your application.
2. The *encoding* information. This describes the format your data will be actually encoded on disk. Different files storing the same data model may be encoded differently. Figuring out the encoding is normally taken care of by the schemaboi library.
3. The *language mapping* information. For example, the field `firstName` in the schema may be named `first_name` by your application.

Every schemaboi file stores the set of data types and the encoding information. The language mapping is language specific, and stays within your application.


### The data model

The data model supports the following types:

- Primitive types (bool, u8-u128, s8-s128, float32, float64, string, byte array, ID)
- Lists
- Maps (list of Primitive => AnyType)
- Structs (A set of fields) - AKA product types
- Enums. Each variant can have associated fields. AKA sum types.


#### Primitive types

Booleans are either `true` or `false`.

The u8, u16, u32, u64, u128 types represent unsigned integer types. And their friends s8, s16, s32, s64, s128 signed integers. u8 and s8 are stored using natural 1-byte encoding. The other integer types are encoded using a length-prefixed varint encoding, so small integers take up fewer bytes than larger integers. Variable length integer types can store up to 128 bit integers. (TODO: Consider making a bigint type?)

Float32 and float64 store IEEE floating point numbers. We store the raw IEEE float bytes in the file. The bit pattern for NaN numbers may not be preserved by all formats.

Strings are stored in UTF-8. All strings must be valid sequences of unicode codepoints. They are not null-terminated. (TODO: Can a string contain '\0'?)

Byte arrays are opaque, and may contain any byte sequence including '\0'. They are essentially a tagged variant of strings which does not need to be valid unicode.

IDs are essentially strings, but IDs are encoded such that if the ID appears multiple times in the data set, the ID will only be stored a single time in the file. Eg: `"G12FQXF", "G18LXIR"`. In some languages (eg Ruby), IDs may be serialized / deserialized using symbols.

#### Lists and maps

Lists contain an ordered sequence of items where every item has the same type. If you want a list where entries have different types, make a list of enum values.

Maps are essentially lists of `(key, value)` entry pairs. The key can be any primitive type. A map is sort of similar to a struct (especially in Javascript), but the keys in a map are stored as data - ie, in the value of the map not the type (as is the case with structs).


#### Structs

A struct is a list of fields, and each field has a type.

Fields can always be added to a data model. When a file is loaded, the known field set is merged with the list of fields the application knows about.

Eg:

```
struct AddressBookEntry: {
  name: string,
  address: string,
  age: uint,
}
```

At heart, every field in a struct is fundamentally optional in schemaboi. If you could add a required field to a struct in schemaboi, any old data (from before that field was added) would be unreadable. When your application loads data with missing fields, its up to your application to decide what happens. You can:

1. Consider the data to be invalid, and throw an error
2. Store the field as missing (`null` / `None` / etc depending on the language)
3. Use a default value


#### Enums

Enums in schemaboi are modelled after their namesake in [rust](https://doc.rust-lang.org/book/ch06-01-defining-an-enum.html) and [swift](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/enumerations/). They are more powerful than their equivalent in C.

An enum is fundamentally a set of *variants*. Each value of an enum type will store 1 of those variants.

Variants can optionally have associated fields. For example, if we wanted to implement the CSS [color](https://developer.mozilla.org/en-US/docs/Web/CSS/color) type, we might do it like this:

```
enum CSSColor: {
  Red,
  Purple,
  Orange,
  // ... And other built-in CSS colors

  RGB { r: uint, g: uint, b: uint },
  RGBA { r: uint, g: uint, b: uint, a: f32 }, // Could be combined with rgb.
  HSL { hue: f32, saturation: f32, luminance: f32 },
  // HWB, etc.
}
```

If you come from a C background, this is like using an enum and union pair.

The associated fields of each enum variant are implemented as an inlined struct. If a variant has no associated fields, it is equivalent to having an empty struct, so you can always add associated fields to that variant later.

Enums have a few extra knobs to make them easier to customize:

- They can be *closed* or *open*. Closed enums can never have new variants added. This is useful when you know up-front all the variants an enum might store, like for a Result type. (This is equivalent to *exhaustive* enums in rust). When decoding an open enum, applications should also be programmed to handle an *unknown* variant type, which may show up for any variants that your application doesn't understand.

- Enums can also be *numeric*, which forbids any associated data from being added to any variants of the enum type.
