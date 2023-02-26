> **STATUS: EXPERIMENTAL**. Do not use this for anything you care about yet! Schemaboi is still in flux, and the binary representation may drift in mutually incompatible ways before 1.0.

# Schemaboi: A binary format with schema evolution

Schemaboi is an efficient serialization format (like JSON or protobuf) thats designed for applications with schemas that change over time. (Which is, basically every application).

Schemaboi has 3 big advantages over other existing formats:

1. **Schema Evolution:** Data stored with schemaboi can be both forwards- *and backwards-* compatible with other application software. Application authors can add new fields to the schema at will. Their new data fields will be preserved by other applications, without interfering with how those apps work. Schemaboi is designed for applications that should still work without modification in 100 years from now.
2. **Encoding efficiency:** Unlike JSON, schemaboi has an extremely compact packed binary format. Data takes even fewer bytes over the wire than other binary formats like protobuf.
3. **Self describing:** Data stored in schemaboi is self describing. Like JSON or msgpack, schemaboi data doesn't need a special out-of-band schema file in order to interpret the data. You can print any schemaboi file out as raw JSON. (Though you need our schemaboi CLI tool to do so). And you don't need a special compilation step to do code generation in order to use schemaboi.

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
[data+schema, data+schema, data+schema]
```

Or protobuf and capnproto, which split the data and the schema into two separate data chunks:

```
[data]
```

And in a separate schema file that needs to be distributed out-of-band and compiled into each program:

```
[schema]
```


## Schema evolution

Schemaboi was written with [local first software](https://www.inkandswitch.com/local-first/) in mind. It was inspired in part by [Cambria](https://www.inkandswitch.com/cambria/).

In local first software, we want *multiple applications* (made by different authors at different times) to be able to interact with the *same shared data*.

We need to be able to add fields to the data model in one application, use those fields in another application while still maintaining compatibility with applications that do not understand those fields. Old, simple software should be able to read and modify data without accidentally deleting fields that newer applications rely on.

JSON does a pretty good job of this, when applications follow a policy where they:

- Only add new fields to the schema, and never remove them
- Preserve any fields that the application does not understand

Schemaboi improves on this. We:

- Formalizes this behaviour (so applications just naturally work this way without needing to do any extra work)
- Allows unused fields to be removed, without deleting any actual data. New files don't store any removed fields, and pay no cost for their historical legacy.

However, we don't support some of the fancier features of cambria, like lenses which convert a single field into a list. (TODO: Might be worth considering though!)


## What is a schema?

In Schemaboi, there are 3 parts of any schema:

1. The set of *data types*. This is a set of struct and enum types which together describe the data to be stored. These types will normally correspond to classes (/ interfaces) and enums in your application.
2. The *encoding* information. This describes the format your data will be actually encoded on disk. Different files storing the same data model may be encoded differently. Figuring out the encoding is normally taken care of by the schemaboi library.
3. The *language mapping* information. For example, the field `firstName` in the schema may be named `first_name` by your application.

Every schemaboi file stores the set of data types and the encoding information. The language mapping is language specific, and stays within your application.


### The data model

The data model supports the following types:

- Primitive types (bool, uint, sint, float32, float64, string, byte array, ID)
- Lists
- Maps (list of Primitive => AnyType)
- Structs (A set of fields)
- Enums


#### Primitive types

Booleans are either `true` or `false`.

Uint and sint represent either unsigned or signed integers. Integers are encoded using a length-prefixed varint encoding, so small integers take up fewer bytes than larger integers. Variable length integer types can store up to 128 bit integers. (TODO: Consider making a bigint type?)

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

1. New fields can be added to structs
2. New enum variants can be added to non-exhaustive enums
3. Enum variants can have associated data added

In the future I may allow other schema changes; but for now this is it.

Given that, given two data models we can define the union (merger) of those  data models. This allows different applications to add application-specific fields to a shared data model without getting in each other's way.

Applications are expected to (generally) ignore unknown fields. And unknown enum variants will either be deserialized as unknown values, or ignored. Some care is required when loading and saving data to ensure any locally-unknown fields are preserved.
