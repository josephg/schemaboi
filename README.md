> **STATUS: EXPERIMENTAL**. Do not use this for anything you care about yet!

# Schemaboi

This is a serialization / deserialization format designed to fill a similar niche as Protobuf or JSON. But its got a twist!

- JSON (and formats like messagepack) are optimized around being easy to use and self-contained. The data formats are dynamically typed - so you don't really know what they'll contain until you open them up. And they're self describing - so you don't need any additional data to interpret JSON or Messagepack content.
- Protobuf (and friends) are instead designed to be fast and small over the wire. The schemas for these formats are expected to be compiled in to applications which use them. This makes application packaging more complex, and the data is no longer self describing. But serialization and deserialization are faster, and the data takes up fewer bytes over the wire.

Schemaboi is built to live in a sweet spot between those extremes:

- Schemaboi files have a formal data schema (like protobuf). But the schema is embedded with the data itself. This means any schemaboi file can be opened, viewed and edited by any compatible program.
- The data schema is very small (usually a handful of bytes). But including it means that (for example), field names don't end up repeated throughout the schemaboi file contents. Serialized size is much smaller than the equivalent JSON / messagepack files. Data aims to be much closer in size to protobuf. (And in fact, it should often be *smaller* than protobuf).
- JSON supports ad-hoc schema evolution. Fields can be added to JSON data, and the expectation is that applications will just ignore any fields they don't understand. If an expected field is missing from a JSON file, usually applications will throw errors during deserialization. Schemaboi allows explicit schema migrations and schema unions.


Schemaboi also supports some data formats that are missing from other systems, like:

- Parametric enums (Eg `enum Shape { Circle(centre, radius), Square(x, y, sidelength) }`).
- Binary data
- *Not implemented yet*: Dates / times.


## Schemas

Schemaboi is built around schemas. Whenever data is serialized or deserialized, a schema is needed to describe the binary format.

The schema serves two purposes:

1. It describes the data model
2. It describes the mapping between data structures in memory and bytes on disk / over the wire

There's often multiple ways for the same data could be serialized. For example, a set of object fields could be ordered in any way. The schema defines a serialization order, and the data is laid out using that order.

Note this is quite different from JSON, which tags each value in an object with its (string) key, or protobuf which tags each field in a message with its type and ID. Schemaboi defines an order for all fields in the schema, and uses that order for each entry. As a result, schemaboi (even after including the schema information in the data bundle) will often be smaller than the equivalent protobuf message(!).

But obviously, this information is necessary for deserializing the data. The schema itself is generally (also) serialized and prefixes any data stored on disk.


### Data model

The data model supports the following types:

- Primitive types (bool, uint, sint, float32, float64)
- Strings
- Byte arrays
- Lists
- Structs
- Enums

Lists are parameterized by a value type.

Structs contain a set of fields. Each field has a name, a type and optionally a default value.

Enums are a set of variants. Each variant may have an associated struct with fields. A variant with no fields is equivalent to a variant with an empty associated struct. (So you can always add fields to a variant).

Struct fields may have a default value. If there's no default value for a struct field in the schema, it should be serialized & deserialized to a nullable type or `Option<>`.


### Schema evolution

File formats inevitably change over time. This is expected and normal; and any serialization system which doesn't allow schema migration is dead.

For schemaboi, the data model is allowed to change in (only) two ways:

1. New fields can be added to structs
2. New enum variants can be added to non-exhaustive enums

In the future I may allow other schema changes; but for now this is it.

Given that, given two data models we can define the union (merger) of those  data models. This allows different applications to add application-specific fields to a shared data model without getting in each other's way.

Applications are expected to (generally) ignore unknown fields. And unknown enum variants will either be deserialized as error values, or ignored. Some care is required when loading and saving data to ensure any locally-unknown fields are preserved.

