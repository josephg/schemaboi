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

Data files with schemaboi data **embed the stored schema** (well, the encoding and core schema). Your application embeds the schema it expects (part 2 and 3). When a SB file is loaded, the stored data is mapped to your local types.

- Anything your application understands is validated and kept.
- Anything your application doesn't understand is stored separately, and re-encoded when the data is saved back to disk. (So we don't lose anything!)

This enables:

- **Schema Evolution:** Data stored with schemaboi can be both forwards- *and backwards-* compatible with other application software. Application authors can add new fields to the schema at will. (Or remove (ignore) old ones). Any new data fields will be preserved by other applications, without interfering with how those apps work. Schemaboi is designed for applications that should still work without modification in 100 years from now.
2. **Encoding efficiency:** Unlike JSON, schemaboi has an extremely compact packed binary format. Data takes even fewer bytes over the wire than other binary formats like protobuf. (Though we do need to store the schema - but its usually small!)
3. **Self describing:** Data stored in schemaboi is self describing. Like JSON or msgpack, schemaboi data doesn't need a special out-of-band schema file in order to interpret the data. You can print any schemaboi file out as raw JSON, or edit it directly. (Though you will need our schemaboi CLI tool to do so). There is no special compilation step to use schemaboi.

Schemaboi also supports more data types than JSON, like opaque binary blobs and parametric enums, as found in modern languages like Swift, Rust, Typescript and Haskell. (Eg `enum Shape { Circle(centre, radius), Square(x, y, sidelength) }`).


## What makes schemaboi different

The big new idea in schemaboi is that the schema for any data set is included inline with the packed binary data. Schemaboi files look like this:

```
[Media type, schema and encoding information]
[Data]
```

This makes schemaboi less efficient for very small data sets. (Though the schema is usually pretty tiny). But much more efficient for very large data sets, where the cost of storing the schema information is amortized.

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
- Structs (A set of fields)
- Enums


#### Primitive types

Booleans are either `true` or `false`.

The u8, u16, u32, u64, u128 types represent unsigned integer types. And their friends s8, s16, s32, s64, s128 signed integers. u8 and s8 are stored using natural 1-byte encoding. The other integer types are encoded using a length-prefixed varint encoding, so small integers take up fewer bytes than larger integers. Variable length integer types can store up to 128 bit integers. (TODO: Consider making a bigint type?)

Float32 and float64 store IEEE floating point numbers. We store the raw IEEE float bytes in the file. The bit pattern for NaN numbers may not be preserved by all formats.

Strings are stored in UTF-8. All strings must be valid sequences of unicode codepoints. They are not null-terminated. (TODO: Can a string contain '\0'?)

Byte arrays are opaque, and may contain any byte sequence including '\0'. They are essentially a tagged variant of strings which does not need to be valid unicode.

IDs are essentially strings, but IDs are encoded such that if the ID appears multiple times in the data set, the ID will only be stored a single time in the file. Eg: `"G12FQXF", "G18LXIR"`

#### Lists and maps

Lists are always homogeneous. Each entry in a list must have the same type. If you want a list where entries have different types, make a list of enum values.

Maps are essentially lists of `(key, value)` entry pairs. The key can be any primitive type. A map is sort of similar to a struct (especially in Javascript), but the keys in a map are stored as data. If you can choose, recommend you use maps when you're storing data with non-uniform keys, and structs when every value in your data set has the same fields.


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


### Schema evolution

File formats inevitably change over time. This is expected and normal; and any serialization system which doesn't allow schema migration is dead.

For schemaboi, the data model is allowed to change in the following ways:

1. New fields can be added or removed from structs
2. New enum variants can be added to non-exhaustive enums
3. Enum variants can have associated data added or removed

In the future I may allow other schema changes; but for now this is it.

Given that, given two data models we can define the union (merger) of those  data models. This allows different applications to add application-specific fields to a shared data model without getting in each other's way.

Applications are expected to (generally) ignore unknown fields. And unknown enum variants will either be deserialized as unknown values, or ignored. Some care is required when loading and saving data to ensure any locally-unknown fields are preserved.
