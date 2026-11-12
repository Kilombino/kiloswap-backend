# Core Lightning for the BLAKE2b chain, for the integration tests: Boltz's
# regtest image (Core Lightning with the hold and clnurl plugins) with
# privkeyio's BLAKE2b port of Core Lightning installed over it, from its
# signed release build for Ubuntu 24.04 (the base of Boltz's image). The
# port keeps upstream's layout and plugin set, cln-grpc included.
#
# The hold plugin is built from source, Boltz's at the commit this
# repository pins (../../hold) with hold-required-features.patch: hold
# invoices carry the features the node requires in its own, so option_blake2b
# (512) on the BLAKE2b network, and rust-lightning knows that bit (as in
# this backend's sidecar), so the plugin can decode them when they are paid.
# Without it the network's nodes, and this backend, refuse every hold
# invoice.
FROM ubuntu:24.04 AS hold

ARG HOLD_COMMIT=af0055b132f3b9f24d0b1d478a15005fcf8f014f
ARG RUST_VERSION=1.98.1

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gcc git libpq-dev libsqlite3-dev pkg-config protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain ${RUST_VERSION}
ENV PATH="/root/.cargo/bin:${PATH}"
RUN git clone https://github.com/BoltzExchange/hold.git /hold && git -C /hold checkout -q ${HOLD_COMMIT}
# lightning-types as published (the checksum of the plugin's Cargo.lock),
# with option_blake2b known (lightning-types-blake2b.patch, the change this
# backend's vendor/lightning-types carries)
ARG LIGHTNING_TYPES_SHA256=f2cd84d4e71472035903e43caded8ecc123066ce466329ccd5ae537a8d5488c7
ADD https://crates.io/api/v1/crates/lightning-types/0.2.0/download /tmp/lightning-types.crate
COPY hold-required-features.patch lightning-types-blake2b.patch /hold/
WORKDIR /hold
RUN echo "${LIGHTNING_TYPES_SHA256}  /tmp/lightning-types.crate" | sha256sum -c - \
    && mkdir -p vendor && tar -xzf /tmp/lightning-types.crate -C vendor \
    && mv vendor/lightning-types-0.2.0 vendor/lightning-types \
    && git apply --directory=vendor/lightning-types lightning-types-blake2b.patch \
    && grep -q "fn supports_blake2b" vendor/lightning-types/src/features.rs \
    && git apply hold-required-features.patch \
    && cargo test --locked --bin hold \
    && cargo build --locked --release

FROM ubuntu:24.04 AS release

ARG CLN_VERSION=v26.06.10-blake2b.1
ARG CLN_SHA256=06f915f0a3fd0e958c3efeac99117daf58af641f07f4129bc8676073b1ab185b

RUN apt-get update && apt-get install -y --no-install-recommends xz-utils && rm -rf /var/lib/apt/lists/*
ADD https://github.com/privkeyio/lightning/releases/download/${CLN_VERSION}/clightning-${CLN_VERSION}-Ubuntu-24.04-amd64.tar.xz /tmp/cln.tar.xz
RUN echo "${CLN_SHA256}  /tmp/cln.tar.xz" | sha256sum -c - \
    && mkdir /cln && tar -xJf /tmp/cln.tar.xz -C /cln

FROM boltz/c-lightning-plugins@sha256:25883773e0488261388820369fff7644a7fe568f2a36ec1fec39f7de0c345e76

RUN rm -rf /usr/libexec/c-lightning
COPY --from=release /cln/usr/ /usr/
COPY --from=hold /hold/target/release/hold /usr/local/bin/hold
RUN lightningd --version
