<script lang="ts">
  /** Test stand-in for `images/ImageView`: renders which picture URL a view asked for. */
  let { src }: { src: string } = $props();
</script>

<span data-src={src}></span>
